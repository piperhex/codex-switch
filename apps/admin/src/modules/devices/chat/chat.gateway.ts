import { OnModuleDestroy } from '@nestjs/common';
import { OnGatewayConnection, OnGatewayDisconnect, WebSocketGateway } from '@nestjs/websockets';
import type { RawData } from 'ws';
import WebSocket from 'ws';
import { ChatAuthService } from './chat-auth.service';
import { ChatSessions } from './chat-sessions';
import { CHAT_FRAME_LIMIT, record, type ChatIdentity } from './protocol';
import { ChatStunService } from './stun.service';

interface Connection {
  identity?: ChatIdentity;
  authenticating: boolean;
  alive: boolean;
  bytes: number;
  frames: number;
  windowStart: number;
  authTimer: NodeJS.Timeout;
}

@WebSocketGateway({ path: '/device-chat', maxPayload: CHAT_FRAME_LIMIT, perMessageDeflate: false })
export class ChatGateway implements OnGatewayConnection, OnGatewayDisconnect, OnModuleDestroy {
  private readonly connections = new Map<WebSocket, Connection>();
  private readonly sessions = new ChatSessions();
  private readonly heartbeat = setInterval(() => this.tick(), 25_000);

  constructor(private readonly auth: ChatAuthService, private readonly stun: ChatStunService) {
    this.heartbeat.unref();
  }

  handleConnection(client: WebSocket) {
    const authTimer = setTimeout(() => client.close(4001, 'Authentication timed out'), 10_000);
    this.connections.set(client, {
      authenticating: false, alive: true, bytes: 0, frames: 0, windowStart: Date.now(), authTimer,
    });
    client.on('pong', () => { const state = this.connections.get(client); if (state) state.alive = true; });
    client.on('message', (raw: RawData, binary: boolean) => {
      void this.receive(client, raw, binary).catch(() => client.close(4001, 'Chat connection rejected'));
    });
    client.once('close', () => this.handleDisconnect(client));
  }

  private async receive(client: WebSocket, raw: RawData, binary: boolean) {
    const state = this.connections.get(client);
    const size = Array.isArray(raw) ? raw.reduce((total, part) => total + part.length, 0) : raw.byteLength;
    if (!state || binary || size > CHAT_FRAME_LIMIT) throw new Error('Invalid frame');
    this.checkRate(state, size);
    const message = record(JSON.parse(raw.toString()) as unknown);
    if (state.identity) {
      if (state.identity.expiresAt <= Date.now()) throw new Error('Expired');
      this.sessions.route(client, message);
      return;
    }
    if (state.authenticating) throw new Error('Authentication pending');
    state.authenticating = true;
    const identity = await this.auth.authenticate(message);
    if (client.readyState !== WebSocket.OPEN || !this.connections.has(client)) return;
    state.identity = identity;
    clearTimeout(state.authTimer);
    state.authTimer = setTimeout(() => client.close(4001, 'Session expired'), identity.expiresAt - Date.now());
    this.sessions.join(client, identity, message, this.stun.iceServers());
  }

  private checkRate(state: Connection, size: number) {
    if (Date.now() - state.windowStart > 1000) {
      state.bytes = 0;
      state.frames = 0;
      state.windowStart = Date.now();
    }
    state.bytes += size;
    state.frames += 1;
    if (state.bytes > 4 * 1024 * 1024 || state.frames > 400) throw new Error('Rate exceeded');
  }

  private tick() {
    for (const [client, state] of this.connections) {
      if (!state.alive) { client.terminate(); continue; }
      state.alive = false;
      if (client.readyState === WebSocket.OPEN) client.ping();
    }
  }

  handleDisconnect(client: WebSocket) {
    const state = this.connections.get(client);
    if (state) clearTimeout(state.authTimer);
    this.connections.delete(client);
    this.sessions.disconnect(client);
  }

  onModuleDestroy() {
    clearInterval(this.heartbeat);
    for (const client of this.connections.keys()) {
      this.handleDisconnect(client);
      client.close(1001, 'Server shutting down');
    }
  }
}
