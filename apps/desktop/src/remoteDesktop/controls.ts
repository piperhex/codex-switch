import { object } from '../../../../shared/remote-chat/protocol';
import type { DesktopCapture } from './capture';

const MAX_INPUT_QUEUE = 64;

export class DesktopControls {
  private queue: object[] = [];
  private busy = false;
  private closed = false;
  constructor(private readonly capture: DesktopCapture, private readonly fail: () => void) {}
  receive(data: string) {
    if (this.closed) return;
    const input = object(JSON.parse(data) as unknown);
    if (!['move', 'button', 'wheel', 'text', 'key'].includes(String(input.kind))) throw new Error('Invalid input');
    const previous = this.queue[this.queue.length - 1] as { kind?: string } | undefined;
    if (input.kind === 'move' && previous?.kind === 'move') this.queue.pop();
    if (this.queue.length >= MAX_INPUT_QUEUE) throw new Error('Input queue full');
    this.queue.push(input);
    void this.flush();
  }
  private async flush() {
    if (this.busy || this.closed) return;
    this.busy = true;
    try {
      while (!this.closed && this.queue.length) await this.capture.input(this.queue.shift());
    } catch { this.fail(); }
    finally { this.busy = false; }
  }
  close() { this.closed = true; this.queue.length = 0; }
}
