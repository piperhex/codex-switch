import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { SessionRenewal } from '../../../../shared/remote-chat/client/sessionRenewal';

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(100_000); });
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

it('renews each lease once and waits when the other endpoint still limits its expiry', async () => {
  const renew = vi.fn(async () => undefined);
  const renewal = new SessionRenewal(renew);
  const expiresAt = Date.now() + 120_000;
  renewal.update(expiresAt);
  await vi.advanceTimersByTimeAsync(60_000);
  renewal.update(expiresAt);
  await vi.advanceTimersByTimeAsync(10_000);
  expect(renew).toHaveBeenCalledOnce();
  renewal.update(Date.now() + 120_000);
  await vi.advanceTimersByTimeAsync(60_000);
  expect(renew).toHaveBeenCalledTimes(2);
  renewal.clear();
  expect(vi.getTimerCount()).toBe(0);
});

it('retries failed renewal with bounded timers and never retries an expired lease', async () => {
  const renew = vi.fn(async () => { throw new Error('Network unavailable'); });
  const renewal = new SessionRenewal(renew);
  renewal.update(Date.now() + 12_000);
  await vi.advanceTimersByTimeAsync(20_000);
  expect(renew).toHaveBeenCalledTimes(3);
  expect(vi.getTimerCount()).toBe(0);
});

it('serializes renewal and reschedules a replacement session after an old request finishes', async () => {
  let finish!: () => void;
  const renew = vi.fn(async (): Promise<void> => undefined)
    .mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
  const renewal = new SessionRenewal(renew);
  renewal.update(Date.now() + 60_000);
  await vi.advanceTimersByTimeAsync(0);
  renewal.clear();
  renewal.update(Date.now() + 120_000);
  await vi.advanceTimersByTimeAsync(65_000);
  expect(renew).toHaveBeenCalledOnce();
  finish();
  await vi.advanceTimersByTimeAsync(1);
  expect(renew).toHaveBeenCalledTimes(2);
  renewal.clear();
});
