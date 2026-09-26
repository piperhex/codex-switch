import type { DesktopInput } from './protocol';

const MAX_BUFFERED_INPUT = 16 * 1024;
const MOVE_INTERVAL = 16;

/** Coalesce pointer motion; button events flush it first so dragging preserves ordering. */
export class DesktopPointer {
  private x = 0.5;
  private y = 0.5;
  private pending = false;
  private timer?: ReturnType<typeof setTimeout>;
  private readonly held = new Set<'left' | 'right'>();
  constructor(private readonly send: (input: DesktopInput) => void) {}
  move(dx: number, dy: number, width: number, height: number) {
    this.x = Math.max(0, Math.min(1, this.x + dx / Math.max(width, 1)));
    this.y = Math.max(0, Math.min(1, this.y + dy / Math.max(height, 1)));
    this.pending = true;
    this.timer ??= setTimeout(() => this.flush(), MOVE_INTERVAL);
  }
  absolute(x: number, y: number) {
    this.x = Math.max(0, Math.min(1, x)); this.y = Math.max(0, Math.min(1, y));
    this.pending = true; this.flush();
  }
  flush() {
    clearTimeout(this.timer); this.timer = undefined;
    if (this.pending) { this.pending = false; this.send({ kind: 'move', x: this.x, y: this.y }); }
  }
  button(button: 'left' | 'right', down: boolean) {
    if (this.held.has(button) === down) return;
    this.flush();
    if (down) this.held.add(button); else this.held.delete(button);
    this.send({ kind: 'button', button, down });
  }
  click(button: 'left' | 'right' = 'left') {
    if (this.held.has(button)) return;
    this.button(button, true); this.button(button, false);
  }
  dispose() { clearTimeout(this.timer); this.pending = false; this.held.clear(); }
}

export function sendDesktopInput(channel: RTCDataChannel | undefined, input: DesktopInput) {
  if (channel?.readyState !== 'open') return;
  if (channel.bufferedAmount > MAX_BUFFERED_INPUT) {
    // Never discard a button release: close the session, which releases held keys on the host.
    channel.close(); return;
  }
  channel.send(JSON.stringify(input));
}
