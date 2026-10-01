import { parseMessage, type ConnectionMode } from './protocol';

const WINDOW_SIZE = 64;
const RETRY_MS = 800;
const DELIVERY_TIMEOUT_MS = 60_000;
const MAX_FRAME_CHARS = 16_000;
interface Pending { text: string; created: number; sent: number; delivered?: () => void }
export interface DeliveryData { kind: 'data'; sequence: number; text: string }

/** A bounded delivery window independent of the path; response fragments may enter assembly out of order. */
export class ReliableDelivery {
  private sequence = 0;
  private received = 0;
  private pausedAt?: number;
  private readonly pending = new Map<number, Pending>();
  private readonly incoming = new Map<number, { text: string; mode?: ConnectionMode }>();

  constructor(private readonly options: {
    send: (frame: DeliveryData, retry: boolean) => boolean;
    accept: (text: string, mode?: ConnectionMode) => void;
    unordered?: boolean;
  }) {}

  get full() { return this.pending.size >= WINDOW_SIZE; }

  /** Only time with an available path counts toward a fragment's delivery deadline. */
  setAvailable(available: boolean, now = Date.now()) {
    if (!available) { this.pausedAt ??= now; return; }
    if (this.pausedAt === undefined) return;
    for (const entry of this.pending.values()) entry.created += now - Math.max(this.pausedAt, entry.created);
    this.pausedAt = undefined;
  }

  enqueue(text: string, delivered?: () => void) {
    if (this.full || text.length > MAX_FRAME_CHARS) throw new Error('连接繁忙，请稍后重试。');
    this.pending.set(++this.sequence, { text, created: Date.now(), sent: 0, delivered });
    this.flush();
  }

  accept(frame: Record<string, unknown>, reply: (frame: object) => void, mode?: ConnectionMode) {
    const sequence = frame.sequence;
    if (!Number.isSafeInteger(sequence) || Number(sequence) < 0) throw new Error('Invalid sequence');
    const value = Number(sequence);
    if (frame.kind === 'ack') {
      if (value > this.sequence) throw new Error('Invalid acknowledgement');
      for (const [id, entry] of this.pending) {
        if (id > value) break;
        this.pending.delete(id);
        entry.delivered?.();
      }
      return;
    }
    if (frame.kind !== 'data' || value < 1 || value > this.received + WINDOW_SIZE
      || typeof frame.text !== 'string' || frame.text.length > MAX_FRAME_CHARS) throw new Error('Invalid delivery');
    if (value > this.received && !this.incoming.has(value)) {
      this.incoming.set(value, { text: frame.text, mode });
      if (this.options.unordered) this.options.accept(frame.text, mode);
    }
    while (this.incoming.has(this.received + 1)) {
      const id = this.received + 1;
      const incoming = this.incoming.get(id)!;
      if (!this.options.unordered) this.options.accept(incoming.text, incoming.mode);
      this.incoming.delete(id);
      this.received = id;
    }
    reply({ kind: 'ack', sequence: this.received });
  }

  flush(force = false) {
    if (this.pausedAt !== undefined) return;
    const now = Date.now();
    for (const [sequence, entry] of this.pending) {
      if (now - entry.created > DELIVERY_TIMEOUT_MS) throw new Error('连接暂时中断，请重新连接。');
      if (!force && entry.sent && now - entry.sent < RETRY_MS) continue;
      if (!this.options.send({ kind: 'data', sequence, text: entry.text }, entry.sent !== 0)) break;
      entry.sent = now;
    }
  }

  clear() { this.pending.clear(); this.incoming.clear(); }
}

export function deliveryFrame(text: string) { return parseMessage(text); }
