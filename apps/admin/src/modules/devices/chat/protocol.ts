import type WebSocket from 'ws';

export const CHAT_FRAME_LIMIT = 48 * 1024;
export const CHAT_BUFFER_LIMIT = 2 * 1024 * 1024;
export const CHAT_SESSION_LIMIT = 4;
export const DIRECT_CONNECT_TIMEOUT = 10_000;

export interface ChatIdentity {
  ownerId: string;
  deviceId: string;
  role: 'desktop' | 'mobile';
  expiresAt: number;
}

export interface ChatSession {
  id: string;
  desktop: WebSocket;
  mobile: WebSocket;
  startedAt: number;
  relay: boolean;
}

export function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid message');
  return value as Record<string, unknown>;
}

export function identifier(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(value)) throw new Error('Invalid id');
  return value;
}

export function publicKey(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) throw new Error('Invalid key');
  return value;
}

export function signal(value: unknown) {
  const message = record(value);
  if (message.kind === 'key') return { kind: 'key', key: publicKey(message.key) };
  if (message.kind === 'sdp' && (message.type === 'offer' || message.type === 'answer')
    && typeof message.sdp === 'string' && message.sdp.length <= 24_000) return message;
  if (message.kind === 'ice' && typeof message.candidate === 'string' && message.candidate.length <= 2048
    && (message.sdpMid === null || typeof message.sdpMid === 'string')
    && (message.sdpMLineIndex === null || Number.isInteger(message.sdpMLineIndex))) return message;
  throw new Error('Invalid signal');
}

export function send(client: WebSocket, message: object) {
  if (client.readyState !== 1) return;
  if (client.bufferedAmount > CHAT_BUFFER_LIMIT) {
    client.close(4008, 'Connection is too slow');
    return;
  }
  client.send(JSON.stringify(message), (error) => { if (error) client.terminate(); });
}
