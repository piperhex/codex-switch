import { afterEach, expect, it, vi } from 'vitest';
import { DesktopPointer, sendDesktopInput } from '../../../../shared/remote-desktop/input';
import { DesktopControls } from './controls';
import type { DesktopCapture } from './capture';

afterEach(() => vi.useRealTimers());
it('coalesces pointer moves and flushes them before mouse presses', () => {
  vi.useFakeTimers();
  const send = vi.fn(); const pointer = new DesktopPointer(send);
  pointer.move(10, -10, 100, 100); pointer.move(10, 0, 100, 100);
  expect(send).not.toHaveBeenCalled();
  pointer.button('left', true);
  expect(send.mock.calls.map(call => call[0])).toEqual([
    { kind: 'move', x: 0.7, y: 0.4 }, { kind: 'button', button: 'left', down: true },
  ]);
  pointer.dispose(); vi.runAllTimers(); expect(send).toHaveBeenCalledTimes(2);
});
it('closes congested control channels so button releases cannot be silently lost', () => {
  const channel = { readyState: 'open', bufferedAmount: 20_000, close: vi.fn(), send: vi.fn() };
  sendDesktopInput(channel as unknown as RTCDataChannel, { kind: 'button', button: 'left', down: false });
  expect(channel.close).toHaveBeenCalled(); expect(channel.send).not.toHaveBeenCalled();
});
it('serializes native input, drops stale motion and preserves button ordering', async () => {
  let complete!: () => void;
  const input = vi.fn().mockImplementationOnce(() => new Promise<void>(resolve => { complete = resolve; }))
    .mockResolvedValue(undefined);
  const controls = new DesktopControls({ input } as unknown as DesktopCapture, vi.fn());
  controls.receive('{"kind":"move","x":0,"y":0}');
  controls.receive('{"kind":"move","x":0.1,"y":0.1}');
  controls.receive('{"kind":"move","x":0.2,"y":0.2}');
  controls.receive('{"kind":"button","button":"left","down":true}');
  expect(input).toHaveBeenCalledTimes(1);
  complete();
  await vi.waitFor(() => expect(input).toHaveBeenCalledTimes(3));
  expect(input.mock.calls[1][0]).toEqual({ kind: 'move', x: 0.2, y: 0.2 });
  expect(input.mock.calls[2][0]).toEqual({ kind: 'button', button: 'left', down: true });
  controls.close();
});
