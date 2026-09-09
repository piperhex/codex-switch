import { MAX_MESSAGE_CHARS, parseMessage, type RpcMessage } from './protocol';

const CHUNK_CHARS = 2400;
const MAX_PARTS = Math.ceil(MAX_MESSAGE_CHARS / CHUNK_CHARS);
const MAX_ASSEMBLIES = 8;
const ASSEMBLY_TTL_MS = 60_000;
interface Assembly { parts: Map<number, string>; total: number; size: number; createdAt: number }

export function* chunks(message: RpcMessage, id: string) {
  // Escape surrogate code units so a chunk boundary cannot split an emoji during UTF-8 encoding.
  const text = JSON.stringify(message).replace(/[\ud800-\udfff]/g,
    (unit) => `\\u${unit.charCodeAt(0).toString(16).padStart(4, '0')}`);
  if (text.length > MAX_MESSAGE_CHARS) throw new Error('对话内容过大，请缩小范围后重试。');
  const total = Math.ceil(text.length / CHUNK_CHARS);
  for (let index = 0; index < total; index += 1) {
    yield JSON.stringify({ id, index, total, text: text.slice(index * CHUNK_CHARS, (index + 1) * CHUNK_CHARS) });
  }
}

export class Assembler {
  private readonly pending = new Map<string, Assembly>();

  accept(text: string): RpcMessage | null {
    const frame = parseMessage(text);
    const { id, index, total, text: part } = frame;
    if (typeof id !== 'string' || id.length > 128 || typeof index !== 'number' || !Number.isInteger(index)
      || typeof total !== 'number' || !Number.isInteger(total) || total < 1 || total > MAX_PARTS
      || index < 0 || index >= total || typeof part !== 'string' || part.length > CHUNK_CHARS) {
      throw new Error('Invalid chunk');
    }
    this.expire();
    let assembly = this.pending.get(id);
    if (!assembly) {
      if (this.pending.size >= MAX_ASSEMBLIES) throw new Error('Too many messages');
      assembly = { parts: new Map(), total, size: 0, createdAt: Date.now() };
      this.pending.set(id, assembly);
    }
    if (assembly.total !== total) throw new Error('Invalid chunk count');
    if (assembly.parts.has(index)) return null;
    assembly.size += part.length;
    if (assembly.size > MAX_MESSAGE_CHARS) throw new Error('Message too large');
    assembly.parts.set(index, part);
    if (assembly.parts.size !== total) return null;
    this.pending.delete(id);
    const joined = Array.from({ length: total }, (_, offset) => assembly.parts.get(offset)).join('');
    const message = parseMessage(joined);
    if (!['request', 'response', 'event'].includes(String(message.kind))) throw new Error('Invalid message');
    return message as unknown as RpcMessage;
  }

  private expire() {
    for (const [id, entry] of this.pending) {
      if (Date.now() - entry.createdAt > ASSEMBLY_TTL_MS) this.pending.delete(id);
    }
  }

  clear() { this.pending.clear(); }
}
