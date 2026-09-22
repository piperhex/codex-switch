import { randomBytes, randomUUID } from 'crypto';
import type WebSocket from 'ws';
import { CHAT_SESSION_LIMIT, identifier, publicKey, record, send, signal, type ChatIdentity } from './protocol';

interface Endpoint { socket: WebSocket; expiresAt: number }
interface Session {
  id: string; resumeToken: string; ownerId: string; deviceId: string;
  desktop: Endpoint; mobile?: Endpoint; expiresAt: number;
}
interface Resume { sessionId: string; resumeToken: string }
const CLOSED_SESSION_TTL_MS = 60_000;
const MAX_CLOSED_SESSIONS = 1024;

function resume(value: unknown): Resume {
  const input = record(value);
  return { sessionId: identifier(input.sessionId), resumeToken: publicKey(input.resumeToken) };
}

/** Resume proofs stay in endpoint memory and are accepted only after normal account/device authentication. */
export class HotSessions {
  constructor(private readonly onRelaySent?: (bytes: number) => void) {}

  private readonly sessions = new Map<string, Session>();
  private readonly closed = new Map<string, { sockets: WebSocket[]; at: number }>();

  count(identity: ChatIdentity) {
    return [...this.sessions.values()].filter((entry) => this.owned(entry, identity)).length;
  }

  register(socket: WebSocket, identity: ChatIdentity, input: unknown) {
    const descriptors = input === undefined ? [] : input;
    if (!Array.isArray(descriptors) || descriptors.length > CHAT_SESSION_LIMIT) throw new Error('Invalid sessions');
    const claims = descriptors.map(resume);
    if (new Set(claims.map((claim) => claim.sessionId)).size !== claims.length) throw new Error('Duplicate sessions');
    for (const claim of claims) this.validateClaim(claim, identity);
    for (const session of this.sessions.values()) {
      if (this.owned(session, identity) && !claims.some((claim) => claim.sessionId === session.id)) {
        this.remove(session);
      }
    }
    for (const claim of claims) {
      let session = this.sessions.get(claim.sessionId);
      if (!session) {
        session = { id: claim.sessionId, resumeToken: claim.resumeToken, ownerId: identity.ownerId,
          deviceId: identity.deviceId, desktop: { socket, expiresAt: identity.expiresAt },
          expiresAt: identity.expiresAt };
        this.sessions.set(session.id, session);
      } else session.desktop = { socket, expiresAt: identity.expiresAt };
      this.ready(session);
    }
  }

  private owned(session: Session, identity: ChatIdentity) {
    return session.ownerId === identity.ownerId && session.deviceId === identity.deviceId;
  }

  private validateClaim(claim: Resume, identity: ChatIdentity) {
    if (this.closed.has(claim.sessionId)) throw new Error('Closed session');
    const session = this.sessions.get(claim.sessionId);
    if (session && (!this.owned(session, identity) || session.resumeToken !== claim.resumeToken)) {
      throw new Error('Invalid session proof');
    }
  }

  join(input: { socket: WebSocket; identity: ChatIdentity; message: Record<string, unknown>;
    desktop: Endpoint; iceServers: object[] }) {
    const { socket, identity, message, desktop, iceServers } = input;
    if (message.resume !== undefined) {
      const claim = resume(message.resume);
      this.validateClaim(claim, identity);
      const session = this.sessions.get(claim.sessionId);
      if (!session || session.desktop.socket !== desktop.socket) {
        socket.close(4004, 'Waiting for PC session'); return;
      }
      const previous = session.mobile?.socket;
      session.mobile = { socket, expiresAt: identity.expiresAt };
      if (previous && previous !== socket) previous.close(4000, 'Connection resumed');
      this.ready(session);
      return;
    }
    const peerKey = publicKey(message.publicKey);
    if ([...this.sessions.values()].filter((entry) => this.owned(entry, identity)).length >= CHAT_SESSION_LIMIT) {
      socket.close(4008, 'Too many chat connections'); return;
    }
    const session: Session = { id: randomUUID(), resumeToken: randomBytes(32).toString('hex'),
      ownerId: identity.ownerId, deviceId: identity.deviceId, desktop,
      mobile: { socket, expiresAt: identity.expiresAt }, expiresAt: Math.min(desktop.expiresAt, identity.expiresAt) };
    this.sessions.set(session.id, session);
    const common = { sessionId: session.id, resumeToken: session.resumeToken, transportVersion: 2,
      iceServers, expiresAt: session.expiresAt };
    send(desktop.socket, { ...common, type: 'peer-open', publicKey: peerKey });
    send(socket, { ...common, type: 'paired' });
  }

  private ready(session: Session) {
    if (!session.mobile) return;
    session.expiresAt = Math.min(session.desktop.expiresAt, session.mobile.expiresAt);
    if (session.desktop.socket.readyState !== 1 || session.mobile.socket.readyState !== 1) return;
    const frame = { type: 'resumed', sessionId: session.id, expiresAt: session.expiresAt };
    send(session.desktop.socket, frame);
    send(session.mobile.socket, frame);
  }

  route(client: WebSocket, message: Record<string, unknown>): boolean {
    const id = identifier(message.sessionId);
    const session = this.sessions.get(id);
    if (!session && this.closed.get(id)?.sockets.includes(client)) return true;
    if (!session) return false;
    if (client !== session.desktop.socket && client !== session.mobile?.socket) throw new Error('Unknown session');
    if (session.expiresAt <= Date.now()) { this.remove(session); return true; }
    const target = client === session.desktop.socket ? session.mobile?.socket : session.desktop.socket;
    if (message.type === 'peer-close') { this.remove(session); return true; }
    if (message.type === 'signal') {
      const payload = signal(message.payload);
      if (target) send(target, { type: 'signal', sessionId: session.id, payload });
      return true;
    }
    if (message.type === 'relay' && typeof message.payload === 'string'
      && /^[a-f0-9]+$/.test(message.payload) && message.payload.length <= 40_000) {
      if (target) send(target, { type: 'relay', sessionId: session.id, payload: message.payload }, this.onRelaySent);
      return true;
    }
    throw new Error('Invalid hot standby frame');
  }

  disconnect(client: WebSocket, revoke = false) {
    for (const session of this.sessions.values()) {
      if (session.desktop.socket !== client && session.mobile?.socket !== client) continue;
      if (revoke) { this.remove(session); continue; }
      const target = session.desktop.socket === client ? session.mobile?.socket : session.desktop.socket;
      if (target) send(target, { type: 'peer-offline', sessionId: session.id });
    }
  }

  prune() {
    for (const session of this.sessions.values()) if (session.expiresAt <= Date.now()) this.remove(session);
    for (const [id, entry] of this.closed) if (Date.now() - entry.at > CLOSED_SESSION_TTL_MS) this.closed.delete(id);
  }

  private remove(session: Session) {
    this.sessions.delete(session.id);
    const sockets = [session.desktop.socket];
    if (session.mobile) sockets.push(session.mobile.socket);
    this.closed.set(session.id, { sockets, at: Date.now() });
    if (this.closed.size > MAX_CLOSED_SESSIONS) this.closed.delete(this.closed.keys().next().value!);
    const frame = { type: 'peer-close', sessionId: session.id };
    send(session.desktop.socket, frame);
    if (session.mobile) send(session.mobile.socket, frame);
  }
}
