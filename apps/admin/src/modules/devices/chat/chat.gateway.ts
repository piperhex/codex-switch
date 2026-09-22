import { ChatSettingsService } from '../../chat-settings/chat-settings.service';
import { ChatTrafficService } from '../../chat-traffic/chat-traffic.service';
import { DEFAULT_CHAT_POLICY } from '../../chat-settings/chat-policy';
import { OnModuleDestroy } from '@nestjs/common';
import { OnGatewayConnection, OnGatewayDisconnect, WebSocketGateway } from '@nestjs/websockets';
import type { RawData } from 'ws';
import WebSocket from 'ws';
import { ChatAuthService } from './chat-auth.service';
import { ChatSessions } from './chat-sessions';
import { CHAT_FRAME_LIMIT, record, send, type ChatIdentity } from './protocol';
import { ChatStunService } from './stun.service';

const POLICY_REFRESH_MS = 5000;
const RATE_WINDOW_MS = 1000;
const MIB = 1024 * 1024;

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
  private readonly sessions: ChatSessions;
  private readonly heartbeat = setInterval(() => this.tick(), 25_000);

  private refreshingPolicy = false;
  private policy = { ...DEFAULT_CHAT_POLICY };
  private readonly policyTimer = setInterval(() => { void this.refreshPolicy(); }, POLICY_REFRESH_MS);

  constructor(private readonly auth: ChatAuthService, private readonly stun: ChatStunService,
    private readonly settings: ChatSettingsService, traffic: ChatTrafficService) {
    this.sessions = new ChatSessions((bytes) => traffic.record(bytes));
    this.policyTimer.unref();
    this.heartbeat.unref();
  }

  handleConnection(client: WebSocket) {
    const authTimer = setTimeout(() => client.close(4001, 'Authentication timed out'), 10_000);
    this.connections.set(client, {
      authenticating: false, alive: true, bytes: 0, frames: 0, windowStart: Date.now(), authTimer,
    });
    client.on('pong', () => { const state = this.connections.get(client); if (state) state.alive = true; });
    client.on('message', (raw: RawData, binary: boolean) => {
      void this.receive(client, raw, binary).catch(() => {
        this.sessions.disconnect(client, true);
        client.close(4001, 'Chat connection rejected');
      });
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
    const policy = await this.settings.read();
    this.policy = policy;
    if (client.readyState !== WebSocket.OPEN || !this.connections.has(client)) return;
    state.identity = identity;
    clearTimeout(state.authTimer);
    state.authTimer = setTimeout(() => {
      this.sessions.disconnect(client, true);
      client.close(4001, 'Session expired');
    }, identity.expiresAt - Date.now());
    send(client, { type: 'chat-policy', policy });
    this.sessions.join(client, identity, message, this.stun.iceServers());
  }

  private async refreshPolicy() {
    if (this.refreshingPolicy || !this.connections.size) return;
    this.refreshingPolicy = true;
    try {
      const policy = await this.settings.read();
      this.policy = policy;
      for (const [client, state] of this.connections) {
        if (state.identity && state.identity.expiresAt > Date.now()) send(client, { type: 'chat-policy', policy });
      }
    } catch { /* Keep the last confirmed policy during a temporary database outage. */ }
    finally { this.refreshingPolicy = false; }
  }

  private checkRate(state: Connection, size: number) {
    if (Date.now() - state.windowStart >= RATE_WINDOW_MS) {
      state.bytes = 0;
      state.frames = 0;
      state.windowStart = Date.now();
    }
    state.bytes += size;
    state.frames += 1;
    const { relayMaxMbPerSecond, relayMaxFramesPerSecond } = this.policy;
    if ((relayMaxMbPerSecond !== -1 && state.bytes / MIB > relayMaxMbPerSecond)
      || (relayMaxFramesPerSecond !== -1 && state.frames > relayMaxFramesPerSecond)) {
      throw new Error('Rate exceeded');
    }
  }

  private tick() {
    this.sessions.prune();
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
    clearInterval(this.policyTimer);
    for (const client of this.connections.keys()) {
      this.handleDisconnect(client);
      client.close(1001, 'Server shutting down');
    }
  }
}
