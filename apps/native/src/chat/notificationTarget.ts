import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils';
import type { AuthSession } from '../types';
import type { GuiEvent } from './types';

export interface ChatNotificationTarget {
  kind: 'chat-completed';
  account: string;
  deviceId: string;
  threadId: string;
  turnId: string;
}
export function chatAccountKey(session: Pick<AuthSession, 'baseUrl' | 'email'>) {
  const server = new URL(session.baseUrl.trim()).toString().replace(/\/+$/, '');
  return bytesToHex(sha256(utf8ToBytes(JSON.stringify([server, session.email.trim().toLowerCase()]))));
}
export function parseChatNotification(value: unknown): ChatNotificationTarget | null {
  if (!value || typeof value !== 'object') return null;
  const entry = value as Record<string, unknown>;
  if (entry.kind !== 'chat-completed' || typeof entry.account !== 'string'
    || !/^[a-f0-9]{64}$/.test(entry.account)) return null;
  for (const key of ['deviceId', 'threadId', 'turnId']) {
    if (typeof entry[key] !== 'string' || !entry[key].trim() || entry[key].length > 200) return null;
  }
  return { kind: 'chat-completed', account: entry.account, deviceId: entry.deviceId as string,
    threadId: entry.threadId as string, turnId: entry.turnId as string };
}
export function notificationId(target: ChatNotificationTarget) {
  return 'chat-' + bytesToHex(sha256(utf8ToBytes(JSON.stringify(target))));
}
export function completedChatTarget(event: GuiEvent, context: { account: string; deviceId: string }) {
  if (event.method !== 'turn/completed' || !['completed', 'failed'].includes(event.params.turn?.status ?? '')) {
    return null;
  }
  return parseChatNotification({ kind: 'chat-completed', ...context,
    threadId: event.params.threadId, turnId: event.params.turn?.id });
}
