import { MAX_MESSAGE_CHARS, parseMessage, type ConnectionMode, type RpcMessage } from './protocol';
import { chatAttachmentDataLimit } from './composerAttachments';
import { MIB } from './policy';

export const CHUNK_CHARS = 2400;
const MESSAGE_RESERVE_CHARS = 2 * MIB;
export function chatMessageCharLimit(mode?: ConnectionMode) {
  return Math.min(Number.MAX_SAFE_INTEGER, Math.max(MAX_MESSAGE_CHARS,
    chatAttachmentDataLimit(mode) + MESSAGE_RESERVE_CHARS));
}
const MAX_ASSEMBLIES = 8;
const ASSEMBLY_TTL_MS = 60_000;
interface Assembly { parts: Map<number, string>; total: number; size: number; updatedAt: number; limit: number }

export function* chunks(message: RpcMessage, id: string, mode?: ConnectionMode, onSerialized?: (text: string) => void) {
  // Escape surrogate code units so a chunk boundary cannot split an emoji during UTF-8 encoding.
  const text = JSON.stringify(message).replace(/[\ud800-\udfff]/g,
    (unit) => `\\u${unit.charCodeAt(0).toString(16).padStart(4, '0')}`);
  if (text.length > chatMessageCharLimit(mode)) throw new Error('对话内容过大，请缩小范围后重试。');
  onSerialized?.(text);
  const total = Math.ceil(text.length / CHUNK_CHARS);
  for (let index = 0; index < total; index += 1) {
    yield JSON.stringify({ id, index, total, text: text.slice(index * CHUNK_CHARS, (index + 1) * CHUNK_CHARS) });
  }
}

export class Assembler {
  private readonly pending = new Map<string, Assembly>();

  constructor(private readonly expireIncomplete = true) {}

  accept(text: string, mode?: ConnectionMode): RpcMessage | null {
    const frame = parseMessage(text);
    const { id, index, total, text: part } = frame;
    this.expire();
    const limit = this.pending.get(String(id))?.limit ?? chatMessageCharLimit(mode);
    if (typeof id !== 'string' || id.length > 128 || typeof index !== 'number' || !Number.isInteger(index)
      || typeof total !== 'number' || !Number.isInteger(total) || total < 1 || total > Math.ceil(limit / CHUNK_CHARS)
      || index < 0 || index >= total || typeof part !== 'string' || part.length > CHUNK_CHARS) {
      throw new Error('Invalid chunk');
    }
    let assembly = this.pending.get(id);
    if (!assembly) {
      if (this.pending.size >= MAX_ASSEMBLIES) throw new Error('Too many messages');
      assembly = { parts: new Map(), total, size: 0, updatedAt: Date.now(), limit };
      this.pending.set(id, assembly);
    }
    if (assembly.total !== total) throw new Error('Invalid chunk count');
    if (assembly.parts.has(index)) return null;
    assembly.size += part.length;
    if (assembly.size > assembly.limit) throw new Error('Message too large');
    assembly.updatedAt = Date.now();
    assembly.parts.set(index, part);
    if (assembly.parts.size !== total) return null;
    this.pending.delete(id);
    const joined = Array.from({ length: total }, (_, offset) => assembly.parts.get(offset)).join('');
    const message = parseMessage(joined);
    if (!['request', 'response', 'event'].includes(String(message.kind))) throw new Error('Invalid message');
    return message as unknown as RpcMessage;
  }

  private expire() {
    if (!this.expireIncomplete) return;
    for (const [id, entry] of this.pending) {
      if (Date.now() - entry.updatedAt > ASSEMBLY_TTL_MS) this.pending.delete(id);
    }
  }

  clear() { this.pending.clear(); }
}
