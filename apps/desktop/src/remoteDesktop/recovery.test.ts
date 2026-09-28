import { afterEach, expect, it, vi } from 'vitest';
import { DesktopRecovery } from '../../../../shared/remote-desktop/recovery';

afterEach(() => vi.useRealTimers());
it('backs off repeated failures, resets only after a stable connection and stops on close', () => {
  vi.useFakeTimers();
  const reconnect = vi.fn();
  const recovery = new DesktopRecovery(reconnect, vi.fn());
  recovery.failed('offline'); recovery.failed('offline');
  vi.advanceTimersByTime(1000); expect(reconnect).toHaveBeenCalledTimes(1);
  recovery.connected(); vi.advanceTimersByTime(500);
  recovery.failed('offline'); vi.advanceTimersByTime(1000);
  expect(reconnect).toHaveBeenCalledTimes(1);
  vi.advanceTimersByTime(1000); expect(reconnect).toHaveBeenCalledTimes(2);
  recovery.connected(); vi.advanceTimersByTime(30_000);
  recovery.failed('offline'); vi.advanceTimersByTime(1000);
  expect(reconnect).toHaveBeenCalledTimes(3);
  recovery.failed('offline'); recovery.stop(); vi.runAllTimers();
  expect(reconnect).toHaveBeenCalledTimes(3);
  expect(vi.getTimerCount()).toBe(0);
});

it('bounds retries when the host remains unavailable', () => {
  vi.useFakeTimers();
  const reconnect = vi.fn(); const status = vi.fn();
  const recovery = new DesktopRecovery(reconnect, status);
  for (let attempt = 0; attempt < 9; attempt++) {
    recovery.failed('unavailable'); vi.runAllTimers();
  }
  expect(reconnect).toHaveBeenCalledTimes(6);
  expect(status).toHaveBeenLastCalledWith('unavailable');
  recovery.stop();
});
