import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ReliableDelivery } from '../../../../shared/remote-chat/delivery';

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(100_000); });
afterEach(() => { vi.useRealTimers(); });

it('pauses only unavailable time and still times out unacknowledged data on an available path', () => {
  const send = vi.fn(() => true);
  const delivery = new ReliableDelivery({ send, accept: () => {} });
  delivery.enqueue('before outage');
  vi.setSystemTime(Date.now() + 20_000);
  delivery.setAvailable(false);
  vi.setSystemTime(Date.now() + 180_000);
  delivery.enqueue('during outage');
  delivery.flush(true);
  expect(send).toHaveBeenCalledOnce();
  delivery.setAvailable(true);
  delivery.flush(true);
  expect(send).toHaveBeenCalledTimes(3);
  vi.setSystemTime(Date.now() + 40_001);
  expect(() => delivery.flush()).toThrow('连接暂时中断');
});

it('keeps the original deadline while repeated availability updates arrive', () => {
  const delivery = new ReliableDelivery({ send: () => true, accept: () => {} });
  delivery.enqueue('waiting for acknowledgement');
  for (let elapsed = 0; elapsed < 60_000; elapsed += 1000) {
    vi.setSystemTime(Date.now() + 1000);
    delivery.setAvailable(true);
    delivery.flush();
  }
  vi.setSystemTime(Date.now() + 1);
  expect(() => delivery.flush()).toThrow('连接暂时中断');
});
