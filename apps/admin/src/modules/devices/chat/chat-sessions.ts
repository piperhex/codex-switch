import { randomUUID } from 'crypto';
import type WebSocket from 'ws';
import {
  CHAT_SESSION_LIMIT, DIRECT_CONNECT_TIMEOUT, identifier, publicKey, send, signal,
  type ChatIdentity, type ChatSession,
} from './protocol';

/** Rendezvous and opaque fallback relay. Conversation data is never stored here. */
export class ChatSessions {
  private readonly desktops = new Map<string, WebSocket>();
  private readonly sessions = new Map<string, ChatSession>();

  join(client: WebSocket, identity: ChatIdentity, message: Record<string, unknown>, iceServers: object[]) {
    const key = `${identity.ownerId}:${identity.deviceId}`;
    if (identity.role === 'desktop') {
      const previous = this.desktops.get(key);
      if (previous && previous !== client) {
        this.disconnect(previous);
        previous.close(4000, 'Replaced by a newer connection');
      }
      this.desktops.set(key, client);
      send(client, { type: 'registered' });
      return;
    }
    const desktop = this.desktops.get(key);
    if (!desktop || desktop.readyState !== 1) {
      client.close(4004, 'PC chat is offline');
      return;
    }
    if ([...this.sessions.values()].filter((entry) => entry.desktop === desktop).length >= CHAT_SESSION_LIMIT) {
      client.close(4008, 'Too many chat connections');
      return;
    }
    const peerKey = publicKey(message.publicKey);
    const id = randomUUID();
    this.sessions.set(id, { id, desktop, mobile: client, startedAt: Date.now(), relay: false });
    send(desktop, { type: 'peer-open', sessionId: id, publicKey: peerKey, iceServers });
    send(client, { type: 'paired', sessionId: id, iceServers, directTimeoutMs: DIRECT_CONNECT_TIMEOUT });
  }

  route(client: WebSocket, message: Record<string, unknown>) {
    const sessionId = identifier(message.sessionId);
    const session = this.sessions.get(sessionId);
    if (!session || (client !== session.desktop && client !== session.mobile)) throw new Error('Unknown session');
    const target = client === session.desktop ? session.mobile : session.desktop;
    if (message.type === 'signal') {
      send(target, { type: 'signal', sessionId, payload: signal(message.payload) });
      return;
    }
    if (message.type === 'relay-request') {
      // Initial fallback is allowed only after the direct attempt. Later transport failures can fall back immediately.
      if (!session.relay && message.reason !== 'disconnected'
        && Date.now() - session.startedAt < DIRECT_CONNECT_TIMEOUT) throw new Error('Direct attempt still pending');
      session.relay = true;
      send(session.desktop, { type: 'relay-ready', sessionId });
      send(session.mobile, { type: 'relay-ready', sessionId });
      return;
    }
    if (message.type === 'relay' && session.relay && typeof message.payload === 'string'
      && /^[a-f0-9]+$/.test(message.payload) && message.payload.length <= 40_000) {
      send(target, { type: 'relay', sessionId, payload: message.payload });
      return;
    }
    if (message.type === 'peer-close') {
      this.sessions.delete(sessionId);
      send(target, { type: 'peer-close', sessionId });
      return;
    }
    throw new Error('Invalid chat frame');
  }

  disconnect(client: WebSocket) {
    for (const [key, desktop] of this.desktops) if (desktop === client) this.desktops.delete(key);
    for (const [id, session] of this.sessions) {
      if (session.desktop !== client && session.mobile !== client) continue;
      this.sessions.delete(id);
      const target = session.desktop === client ? session.mobile : session.desktop;
      send(target, { type: 'peer-close', sessionId: id });
    }
  }
}
