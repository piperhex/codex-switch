import { expect, test } from '@playwright/test';

test('keeps video playing when sound autoplay is blocked and enables sound on a tap', async ({ page }) => {
  await page.addInitScript(() => {
    const play = HTMLMediaElement.prototype.play;
    let denied = false;
    HTMLMediaElement.prototype.play = function() {
      if (!denied && this.srcObject && !this.muted) {
        denied = true;
        return Promise.reject(new DOMException('User gesture required', 'NotAllowedError'));
      }
      return play.call(this);
    };
  });
  await page.goto('e2e/remote-desktop-harness.html?audio=1');
  await page.getByRole('button', { name: '打开工具' }).click();
  await page.getByRole('button', { name: '远程桌面', exact: true }).click();
  await expect.poll(() => page.locator('video').evaluate(video => video.videoWidth)).toBeGreaterThan(0);
  await expect.poll(() => page.locator('video').evaluate(video => video.muted)).toBe(true);
  await page.getByRole('button', { name: '开启声音', exact: true }).click();
  await expect.poll(() => page.locator('video').evaluate(video => video.muted)).toBe(false);
  await expect(page.getByRole('button', { name: '静音', exact: true })).toHaveAttribute('aria-pressed', 'true');
});

test('plays audio and video together, mutes and resumes without interrupting video', async ({ page }, info) => {
  await page.goto('e2e/remote-desktop-harness.html?audio=1');
  await page.getByRole('button', { name: '打开工具' }).click();
  await page.getByRole('button', { name: '远程桌面', exact: true }).click();
  const video = page.locator('video');
  await expect.poll(() => video.evaluate(element => element.videoWidth)).toBeGreaterThan(0);
  await expect.poll(() => video.evaluate(element =>
    (element.srcObject as MediaStream)?.getAudioTracks().length)).toBe(1);
  const enable = page.getByRole('button', { name: '开启声音', exact: true });
  if (await enable.isVisible()) await enable.click();
  await expect(page.getByRole('button', { name: '静音', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => video.evaluate(element => element.muted)).toBe(false);
  await page.getByRole('button', { name: '静音', exact: true }).click();
  await expect.poll(() => video.evaluate(element =>
    (element.srcObject as MediaStream).getAudioTracks()[0].enabled)).toBe(false);
  const frames = await video.evaluate(element => element.getVideoPlaybackQuality().totalVideoFrames);
  await expect.poll(() => video.evaluate(element => element.getVideoPlaybackQuality().totalVideoFrames))
    .toBeGreaterThan(frames);
  await enable.click();
  await expect.poll(() => video.evaluate(element =>
    (element.srcObject as MediaStream).getAudioTracks()[0].enabled)).toBe(true);
  await page.screenshot({ path: info.outputPath('desktop-audio.png') });
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  await expect(video).toHaveCount(0);
});
