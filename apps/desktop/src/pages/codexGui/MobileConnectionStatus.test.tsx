// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { MobileConnectionStatus } from './MobileConnectionStatus';
import { mobileConnection } from '../../remoteChat/mobileConnection';
import { connectionDetails } from '../../remoteChat/connectionDetails';

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  connectionDetails.reset(); mobileConnection.setConnected(false);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); connectionDetails.reset(); });

it('opens device details and refreshes modes, relay counters and monthly allowance while open', async () => {
  connectionDetails.open('phone-id', { name: 'Pixel 9', platform: 'Android' });
  connectionDetails.update('phone-id', { mode: 'direct' });
  mobileConnection.setConnected(true);
  await act(async () => root.render(<MobileConnectionStatus />));
  await act(async () => host.querySelector<HTMLButtonElement>('button')!.click());
  expect(document.body.textContent).toContain('Pixel 9');
  expect(document.body.textContent).toContain('P2P 直连');
  await act(async () => {
    connectionDetails.update('phone-id', { mode: 'relay' });
    connectionDetails.traffic('phone-id', { uploadBytes: 1024, downloadBytes: 1024 });
    connectionDetails.quota({ monthUsedBytes: 2048, monthlyLimitBytes: -1, resetAt: '2026-10-01T00:00:00+08:00' }, false);
  });
  expect(document.body.textContent).toContain('Relay 转发');
  expect(document.body.textContent).toContain('本次转发：2 KB');
  expect(document.body.textContent).toContain('2 KB / 不限量');
  await act(async () => { connectionDetails.remove('phone-id'); mobileConnection.setConnected(false); });
  expect(document.body.textContent).toContain('暂无设备连接到这台电脑。');
});
