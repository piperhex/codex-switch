import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { hotLinkHarness } from './hotLinkHarness';

let harness: ReturnType<typeof hotLinkHarness>;
const phonePublic = { host: '203.0.113.8', port: 42123, protocol: 'udp' as const };
const pcPublic = { host: '198.51.100.8', port: 46184, protocol: 'udp' as const };
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(100_000);
  harness = hotLinkHarness({ endpoints: {
    phone: { local: { host: '172.19.0.1', port: 47894, protocol: 'udp' }, remote: pcPublic },
    pc: { local: { host: '192.168.1.8', port: 36184, protocol: 'udp' }, remote: phonePublic },
  } });
});
afterEach(() => { harness.close(); vi.useRealTimers(); });

it('confirms the phone public mapping through encrypted direct replies without leaking addresses to relay probes',
async () => {
  await vi.advanceTimersByTimeAsync(4500);
  expect(harness.links.phone.directEndpoints).toEqual({ ...harness.endpoints.phone, localPublic: phonePublic });
  expect(harness.links.pc.directEndpoints).toEqual({ ...harness.endpoints.pc, localPublic: pcPublic });
  const pongs = harness.packets.filter(packet => packet.frame.kind === 'pong');
  expect(pongs.some(packet => packet.path === 'direct' && packet.frame.observedEndpoint)).toBe(true);
  expect(pongs.filter(packet => packet.path === 'relay').every(packet => !packet.frame.observedEndpoint)).toBe(true);
  expect(harness.error).not.toHaveBeenCalled();
});

it('refreshes a changed mapping and removes it on relay, reconnect and close', async () => {
  await vi.advanceTimersByTimeAsync(4500);
  const changed = { ...phonePublic, port: 54321 };
  harness.endpoints.pc!.remote = changed;
  await vi.advanceTimersByTimeAsync(1000);
  expect(harness.links.phone.directEndpoints?.localPublic).toEqual(changed);
  harness.paths.direct = false;
  await vi.advanceTimersByTimeAsync(4000);
  expect(harness.links.phone.directEndpoints).toBeUndefined();
  harness.paths.direct = true;
  harness.endpoints.pc = undefined;
  await vi.advanceTimersByTimeAsync(4500);
  expect(harness.links.phone.directEndpoints).toEqual(harness.endpoints.phone);
  expect(harness.error).not.toHaveBeenCalled();
  harness.close();
  expect(harness.links.phone.directEndpoints).toBeUndefined();
  expect(vi.getTimerCount()).toBe(0);
});

it('keeps LAN connections private and tolerates peers that cannot report addresses', async () => {
  harness.endpoints.pc!.remote = { ...phonePublic, host: '192.168.1.4' };
  await vi.advanceTimersByTimeAsync(4500);
  expect(harness.links.phone.directEndpoints).toEqual(harness.endpoints.phone);
  harness.endpoints.pc = undefined;
  await vi.advanceTimersByTimeAsync(1000);
  expect(harness.links.phone.directEndpoints).toEqual(harness.endpoints.phone);
  expect(harness.error).not.toHaveBeenCalled();
});
