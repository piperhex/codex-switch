import { expect, test } from '@playwright/test';
import type { desktopTest } from './remote-desktop-fixture';

declare global { interface Window { desktopTest: typeof desktopTest } }

test('keeps and repairs a silent relay backup after an initial direct connection, then resumes media on it',
  async ({ page }, info) => {
    test.skip(!process.env.DESKTOP_UPGRADE_TEST_ICE, 'requires isolated local TURN fixture');
    test.setTimeout(90_000);
    await page.addInitScript(iceServers => {
      window.desktopRelayFixture = { iceServers, upgrade: true, directFirst: true };
    }, JSON.parse(process.env.DESKTOP_UPGRADE_TEST_ICE!));
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto('e2e/remote-desktop-harness.html');
    await page.getByRole('button', { name: '打开工具' }).click();
    await page.getByRole('button', { name: '远程桌面', exact: true }).click();
    const video = page.locator('video');
    await expect.poll(() => video.evaluate(element => element.videoWidth), { timeout: 20_000 }).toBeGreaterThan(0);
    await expect.poll(() => page.evaluate(() => window.desktopTest.peers.filter(peer =>
      peer.connectionState === 'connected').length), { timeout: 25_000 }).toBe(4);
    await expect.poll(() => page.evaluate(() => window.desktopTest.standbyReady.length)).toBe(1);
    const relayFrames = () => page.evaluate(async () => {
      const reports = await window.desktopTest.peers[3].getStats();
      const video = [...reports.values()].find(report => report.type === 'outbound-rtp' && report.kind === 'video');
      return video?.framesEncoded ?? 0;
    });
    // Idle TURN carries control traffic only; no second encoder keeps sending the desktop.
    const before = await relayFrames();
    await expect.poll(async () => {
      const frames = await video.evaluate(element => element.getVideoPlaybackQuality().totalVideoFrames);
      return frames;
    }).toBeGreaterThan(30);
    expect(await relayFrames()).toBe(before);
    await page.evaluate(() => window.desktopTest.peers[2].close());
    // ICE connectivity precedes the standby commit and its usable control channel.
    await expect.poll(() => page.evaluate(() => window.desktopTest.standbyReady
      .some(peer => window.desktopTest.peers.indexOf(peer) >= 4 && peer.connectionState === 'connected')),
    { timeout: 25_000 }).toBe(true);
    expect(await page.evaluate(() => window.desktopTest.peers[0].connectionState)).toBe('connected');
    await page.evaluate(() => window.desktopTest.peers[0].close());
    await expect.poll(() => page.evaluate(() => window.desktopTest.peers[1].connectionState)).toBe('closed');
    const frames = await video.evaluate(element => element.getVideoPlaybackQuality().totalVideoFrames);
    await expect.poll(() => video.evaluate(element => element.getVideoPlaybackQuality().totalVideoFrames))
      .toBeGreaterThan(frames + 5);
    await page.getByRole('button', { name: '显示桌面', exact: true }).click();
    await expect.poll(() => page.evaluate(() => window.desktopTest.inputs.length)).toBeGreaterThan(0);
    expect(await page.evaluate(() => window.desktopTest.captures)).toBe(1);
    await page.screenshot({ path: info.outputPath('relay-fallback.png') });
    await page.getByRole('button', { name: '关闭', exact: true }).click();
    await expect.poll(() => page.evaluate(() => window.desktopTest.peers.every(peer => peer.connectionState === 'closed')))
      .toBe(true);
    expect(errors).toEqual([]);
  });
