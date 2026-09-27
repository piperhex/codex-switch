import type { Channel, PeerOptions } from './protocol';

const PROBE_MS = 1000;
const PATH_TIMEOUT_MS = 3000;
const MAX_ENVELOPE_CHARS = 100_000;
interface Path { channel: Channel; priority: number; pong: number; probe: number; pending: Set<number> }

/** Peers may select different outgoing paths; every incoming path carries the same authenticated chat protocol. */
export class MultipathChannel implements Channel {
  private readonly paths = new Set<Path>();
  private selected?: Path;
  private state = 'connecting';
  private readonly opened = new Set<() => void>();
  private readonly closed = new Set<() => void>();
  private readonly messages = new Set<(text: string) => void>();
  private readonly timer = setInterval(() => this.tick(), PROBE_MS);

  constructor(private readonly options: Pick<PeerOptions, 'stateChanged' | 'disconnected'>) {}
  get readyState() { return this.state; }
  get bufferedAmount() { return this.selected?.channel.bufferedAmount ?? 0; }
  onOpen(callback: () => void) { this.opened.add(callback); }
  onClose(callback: () => void) { this.closed.add(callback); }
  onMessage(callback: (text: string) => void) { this.messages.add(callback); }

  add(channel: Channel, priority: number) {
    if (this.state === 'closed') { channel.close(); return; }
    const path: Path = { channel, priority, pong: 0, probe: 0, pending: new Set() };
    this.paths.add(path);
    channel.onMessage(text => this.receive(path, text));
    channel.onOpen(() => this.probe(path));
    channel.onClose(() => { this.paths.delete(path); this.choose(); });
    if (channel.readyState === 'open') this.probe(path);
  }

  private probe(path: Path) {
    if (path.channel.readyState !== 'open') return;
    const sequence = ++path.probe;
    path.pending.add(sequence);
    if (path.pending.size > 4) path.pending.delete(path.pending.values().next().value!);
    this.write(path, ['ping', sequence]);
  }

  private write(path: Path, frame: unknown[]) {
    try { path.channel.send(JSON.stringify(frame)); }
    catch { path.pong = 0; }
  }

  private receive(path: Path, text: string) {
    if (this.state === 'closed' || !this.paths.has(path)) return;
    try {
      if (text.length > MAX_ENVELOPE_CHARS) throw new Error('Invalid path packet');
      const frame: unknown = JSON.parse(text);
      if (!Array.isArray(frame) || frame.length !== 2) throw new Error('Invalid path frame');
      if (frame[0] === 'ping' && Number.isSafeInteger(frame[1])) this.write(path, ['pong', frame[1]]);
      else if (frame[0] === 'pong' && path.pending.delete(Number(frame[1]))) {
        path.pong = Date.now(); this.choose();
      } else if (frame[0] === 'data' && typeof frame[1] === 'string') {
        this.messages.forEach(callback => callback(frame[1]));
      }
    } catch { path.channel.close(); }
  }

  private choose() {
    if (this.state === 'closed') return;
    const now = Date.now();
    this.selected = [...this.paths].filter(path => path.channel.readyState === 'open'
      && path.pong > 0 && now - path.pong < PATH_TIMEOUT_MS).sort((a, b) => a.priority - b.priority)[0];
    const state = this.selected ? 'open' : 'connecting';
    if (state === this.state) return;
    this.state = state;
    this.options.stateChanged?.(state === 'open' ? 'connected' : 'disconnected');
    if (state === 'open') this.opened.forEach(callback => callback());
    else this.options.disconnected();
  }

  private tick() { this.paths.forEach(path => this.probe(path)); this.choose(); }

  send(text: string) {
    if (!this.selected || this.state !== 'open') throw new Error('Direct paths unavailable');
    this.selected.channel.send(JSON.stringify(['data', text]));
  }

  close() {
    if (this.state === 'closed') return;
    this.state = 'closed';
    clearInterval(this.timer);
    this.paths.forEach(path => path.channel.close());
    this.paths.clear();
    this.closed.forEach(callback => callback());
    this.opened.clear(); this.closed.clear(); this.messages.clear();
  }
}
