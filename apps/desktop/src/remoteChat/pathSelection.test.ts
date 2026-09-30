import { afterEach, expect, it, vi } from 'vitest';
import { MultipathChannel } from '../../../../shared/remote-chat/multipathChannel';
import type { Channel } from '../../../../shared/remote-chat/protocol';

afterEach(() => vi.useRealTimers());

function timedPath(latency: number) {
  let receive = (_text: string) => {};
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const send = vi.fn((text: string) => {
    const [kind, sequence] = JSON.parse(text) as [string, number];
    if (kind !== 'ping') return;
    const timer = setTimeout(() => { timers.delete(timer); receive(JSON.stringify(['pong', sequence])); }, latency);
    timers.add(timer);
  });
  const channel: Channel = { readyState: 'open', bufferedAmount: 0, send,
    onMessage: callback => { receive = callback; }, onOpen: vi.fn(), onClose: vi.fn(),
    close: () => timers.forEach(timer => clearTimeout(timer)) };
  return { channel, send, setLatency: (next: number) => { latency = next; } };
}

it('selects a consistently faster native route and resists insignificant RTT fluctuations', () => {
  vi.useFakeTimers(); vi.setSystemTime(10_000);
  const rtc = timedPath(150), mesh = timedPath(20);
  const diagnostic = vi.fn(), channel = new MultipathChannel({ disconnected: vi.fn(), diagnostic });
  channel.add(rtc.channel, 0, 'rtc');
  vi.advanceTimersByTime(200);
  channel.add(mesh.channel, 1, 'mesh');
  vi.advanceTimersByTime(4000);
  channel.send('before stable window');
  expect(rtc.send).toHaveBeenLastCalledWith(JSON.stringify(['data', 'before stable window']));
  vi.advanceTimersByTime(1500);
  channel.send('faster route');
  expect(mesh.send).toHaveBeenLastCalledWith(JSON.stringify(['data', 'faster route']));
  const switches = diagnostic.mock.calls.filter(([event]) => event === 'path-selected').length;
  rtc.setLatency(25);
  vi.advanceTimersByTime(8000);
  channel.send('stable route');
  expect(mesh.send).toHaveBeenLastCalledWith(JSON.stringify(['data', 'stable route']));
  expect(diagnostic.mock.calls.filter(([event]) => event === 'path-selected')).toHaveLength(switches);
  channel.close(); expect(vi.getTimerCount()).toBe(0);
});
