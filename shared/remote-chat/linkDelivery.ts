import { Acknowledgements } from './acknowledgements';
import { ReliableDelivery } from './delivery';
import { Assembler } from './framing';
import { SendQueue } from './sendQueue';
import type { ConnectionMode, RpcMessage } from './protocol';
import type { TransferProgress } from './uploadProgress';

type Lane = 'ordered' | 'responses';
interface Stream {
  delivery: ReliableDelivery;
  outgoing: SendQueue;
  acknowledgements: Acknowledgements;
  waiters: Set<() => void>;
}

/** Events/commands retain order. Independent response fragments have their own window and acknowledgements. */
export class LinkDelivery {
  private readonly assembler = new Assembler(false);
  private readonly streams: Record<Lane, Stream>;
  private parallel = false;
  private closed = false;

  constructor(private readonly options: {
    send: (frame: object) => boolean;
    message: (message: RpcMessage) => void;
    mode: () => ConnectionMode;
  }) {
    this.streams = { ordered: this.create('ordered'), responses: this.create('responses') };
  }

  enableResponses() { this.parallel = true; }

  private create(lane: Lane): Stream {
    const delivery = new ReliableDelivery({
      unordered: lane === 'responses',
      send: (frame) => this.options.send(this.envelope(lane, frame)),
      accept: (text, mode) => {
        const message = this.assembler.accept(text, mode);
        if (message && lane === 'responses' && message.kind !== 'response') throw new Error('Invalid response lane');
        if (message) this.options.message(message);
      },
    });
    const outgoing = new SendQueue({
      capacity: () => this.capacity(lane), mode: this.options.mode,
      prefix: `${lane}:`,
      send: (part, delivered) => delivery.enqueue(part, delivered),
    });
    return { delivery, outgoing, acknowledgements: new Acknowledgements(), waiters: new Set() };
  }

  private envelope(lane: Lane, frame: object) {
    return lane === 'responses' ? { ...frame, lane } : frame;
  }

  send(message: RpcMessage, progress?: TransferProgress) {
    const lane = this.parallel && message.kind === 'response' ? 'responses' : 'ordered';
    return this.streams[lane].outgoing.send(message, progress);
  }

  accept(frame: Record<string, unknown>, reply: (frame: object) => void, mode: ConnectionMode) {
    if (frame.lane !== undefined && frame.lane !== 'responses') throw new Error('Invalid delivery lane');
    const lane = frame.lane === 'responses' ? 'responses' : 'ordered';
    const stream = this.streams[lane];
    stream.delivery.accept(frame, (ack) => stream.acknowledgements.schedule(ack,
      (latest) => reply(this.envelope(lane, latest))), mode);
    if (!stream.delivery.full) this.release(stream);
  }

  flush(force = false) {
    for (const stream of Object.values(this.streams)) stream.delivery.flush(force);
  }

  private async capacity(lane: Lane) {
    const stream = this.streams[lane];
    while (!this.closed && stream.delivery.full) {
      await new Promise<void>((resolve) => stream.waiters.add(resolve));
    }
    if (this.closed) throw new Error('电脑已断开连接。');
  }

  private release(stream: Stream) {
    for (const resolve of stream.waiters) resolve();
    stream.waiters.clear();
  }

  clear() {
    this.closed = true;
    for (const stream of Object.values(this.streams)) {
      stream.outgoing.close();
      stream.delivery.clear();
      stream.acknowledgements.clear();
      this.release(stream);
    }
    this.assembler.clear();
  }
}
