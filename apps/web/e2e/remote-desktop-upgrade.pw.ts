import { expect, test } from '@playwright/test';
import type { desktopTest } from './remote-desktop-fixture';
declare global { interface Window { desktopTest: typeof desktopTest } }

test('keeps relay video and controls during failed probes, then promotes decoded direct media', async ({ page }) => {
  test.skip(!process.env.DESKTOP_UPGRADE_TEST_ICE, 'requires isolated local TURN fixture');
  test.setTimeout(100_000);
  await page.addInitScript(iceServers => {
    window.desktopRelayFixture = { iceServers, upgrade: true, failDirectAttempts: 1, loseCommitReply: true };
  }, JSON.parse(process.env.DESKTOP_UPGRADE_TEST_ICE!));
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('e2e/remote-desktop-harness.html');
  await page.getByRole('button', { name: '打开工具' }).click();
  await page.getByRole('button', { name: '远程桌面', exact: true }).click();
  const video = page.locator('video');
  await expect.poll(() => video.evaluate(element => element.videoWidth), { timeout: 20_000 }).toBeGreaterThan(0);
  await expect.poll(() => page.evaluate(() => window.desktopTest.peers.length), { timeout: 15_000 }).toBe(4);
  const before = await video.evaluate(element => element.getVideoPlaybackQuality().totalVideoFrames);
  await expect.poll(() => video.evaluate(element => element.getVideoPlaybackQuality().totalVideoFrames))
    .toBeGreaterThan(before + 10);
  expect(await page.evaluate(() => window.desktopTest.peers.slice(0, 2).map(peer => peer.connectionState)))
    .toEqual(['connected', 'connected']);
  await page.getByRole('button', { name: '显示桌面', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.desktopTest.inputs.length)).toBeGreaterThan(0);
  await expect.poll(() => page.evaluate(() => window.desktopTest.peers.length), { timeout: 60_000 }).toBe(6);
  await expect.poll(() => page.evaluate(() => window.desktopTest.peers.slice(0, 4)
    .every(peer => peer.connectionState === 'closed')), { timeout: 20_000 }).toBe(true);
  expect(await page.evaluate(() => window.desktopTest.captures)).toBe(1);
  const direct = await page.evaluate(async () => Promise.all(window.desktopTest.peers.slice(4).map(async peer => {
    const report = await peer.getStats();
    const transport = [...report.values()].find(value => value.type === 'transport' && value.selectedCandidatePairId);
    const pair = report.get(transport.selectedCandidatePairId);
    return [report.get(pair.localCandidateId).candidateType, report.get(pair.remoteCandidateId).candidateType];
  })));
  expect(direct.flat()).not.toContain('relay');
  const after = await video.evaluate(element => element.getVideoPlaybackQuality().totalVideoFrames);
  await expect.poll(() => video.evaluate(element => element.getVideoPlaybackQuality().totalVideoFrames))
    .toBeGreaterThan(after + 5);
  const inputs = await page.evaluate(() => window.desktopTest.inputs.length);
  await page.getByRole('button', { name: '显示桌面', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.desktopTest.inputs.length)).toBeGreaterThan(inputs);
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.desktopTest.peers.every(peer => peer.connectionState === 'closed')))
    .toBe(true);
  expect(errors).toEqual([]);
});
