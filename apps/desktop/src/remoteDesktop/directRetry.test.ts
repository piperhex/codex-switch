import { afterEach, expect, it, vi } from 'vitest';
import { DesktopDirectRetry } from '../../../../shared/remote-desktop/directRetry';

afterEach(() => vi.useRealTimers());

it('increases cooldown after short-lived direct connections and caps it at a minute', () => {
  vi.useFakeTimers(); vi.setSystemTime(0);
  const retry = new DesktopDirectRetry();
  expect(retry.delay).toBe(5000);
  for (const delay of [15_000, 30_000, 60_000, 60_000]) {
    retry.update('direct'); vi.advanceTimersByTime(100);
    retry.update('relay'); retry.update('relay'); retry.update();
    expect(retry.delay).toBe(delay);
    retry.end(); // Recreating the media session must retain the viewer's cooldown.
    expect(retry.delay).toBe(delay);
  }
  expect(vi.getTimerCount()).toBe(0);
});

it('resets backoff only after direct service has stayed stable for thirty seconds', () => {
  vi.useFakeTimers();
  const retry = new DesktopDirectRetry(); retry.failed(); retry.failed();
  retry.update('direct'); vi.advanceTimersByTime(29_999); retry.update('direct');
  expect(retry.delay).toBe(30_000);
  vi.advanceTimersByTime(1); retry.update('relay');
  expect(retry.delay).toBe(5000);
  retry.failed(); retry.update('direct'); vi.advanceTimersByTime(30_000); retry.update('direct');
  expect(retry.delay).toBe(5000);
});

it('does not penalize an intentional display change or carry its direct uptime into another session', () => {
  vi.useFakeTimers();
  const retry = new DesktopDirectRetry(); retry.update('direct');
  retry.end(); retry.update('relay');
  expect(retry.delay).toBe(5000);
  retry.failed(); retry.update('direct'); retry.end();
  vi.advanceTimersByTime(30_000); retry.update('relay');
  expect(retry.delay).toBe(15_000);
});
