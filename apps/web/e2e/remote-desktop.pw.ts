import { expect, test } from '@playwright/test';
import type { desktopTest } from './remote-desktop-fixture';

declare global { interface Window { desktopTest: typeof desktopTest } }

test.beforeEach(async ({ page }) => {
  if (!process.env.DESKTOP_RELAY_TEST_ICE) return;
  await page.addInitScript(configuration => { window.desktopRelayFixture = configuration; },
    { iceServers: JSON.parse(process.env.DESKTOP_RELAY_TEST_ICE) });
});

test.afterEach(async ({ page }, info) => {
  if (!process.env.DESKTOP_RELAY_TEST_ICE || info.status === info.expectedStatus) return;
  console.log(await page.evaluate(async () => ({ errors: window.desktopTest.iceErrors,
    peers: await Promise.all(window.desktopTest.peers.map(async peer => ({
      state: peer.connectionState, gathering: peer.iceGatheringState,
      candidates: [...(await peer.getStats()).values()].filter(report => report.type.includes('candidate')),
    }))),
  })));
});

test('streams video, controls mouse and keyboard, applies display settings and closes capture', async ({ page }, info) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('e2e/remote-desktop-harness.html');
  await page.getByRole('button', { name: '打开工具' }).click();
  await page.getByRole('button', { name: '远程桌面', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '远程桌面' })).toBeVisible();
  await expect.poll(() => page.locator('video').evaluate(video => video.videoWidth), { timeout: 20_000 })
    .toBeGreaterThan(0);
  await expect.poll(() => page.locator('video').evaluate(video => video.getVideoPlaybackQuality().totalVideoFrames))
    .toBeGreaterThan(5);
  await expect(page.getByText('正在连接桌面…')).not.toBeVisible();
  if (process.env.DESKTOP_RELAY_TEST_ICE) {
    const routes = await page.evaluate(async () => Promise.all(window.desktopTest.peers.map(async peer => {
      const reports = await peer.getStats();
      const selected = [...reports.values()].find(report => report.type === 'candidate-pair'
        && report.state === 'succeeded' && report.nominated);
      return selected ? reports.get(selected.localCandidateId) : undefined;
    })));
    expect(routes).toHaveLength(2);
    for (const route of routes) {
      expect(route?.candidateType).toBe('relay');
      expect(route?.relayProtocol).toBe(process.env.DESKTOP_RELAY_TEST_PROTOCOL);
    }
    const beforeRefresh = await page.locator('video').evaluate(video => video.getVideoPlaybackQuality().totalVideoFrames);
    // The coturn fixture refreshes allocations every five seconds; credentials expire after twelve seconds.
    await page.waitForTimeout(15_000);
    await expect.poll(() => page.locator('video').evaluate(video => video.getVideoPlaybackQuality().totalVideoFrames))
      .toBeGreaterThan(beforeRefresh + 20);
  }
  const collapsed = page.getByRole('button', { name: '展开鼠标面板' });
  if (await collapsed.isVisible()) await collapsed.click();
  await page.getByRole('button', { name: '鼠标左键', exact: true }).click();
  await page.getByRole('button', { name: '鼠标右键', exact: true }).click();
  await page.getByRole('button', { name: '向下滚动' }).click();
  await expect.poll(() => page.evaluate(() => window.desktopTest.inputs.length)).toBe(8);
  expect(await page.evaluate(() => window.desktopTest.inputs)).toEqual([
    { kind: 'move', x: 0.5, y: 0.5 },
    { kind: 'button', button: 'left', down: true }, { kind: 'button', button: 'left', down: false },
    { kind: 'move', x: 0.5, y: 0.5 },
    { kind: 'button', button: 'right', down: true }, { kind: 'button', button: 'right', down: false },
    { kind: 'move', x: 0.5, y: 0.5 }, { kind: 'wheel', delta: -120 },
  ]);
  await page.screenshot({ path: info.outputPath('remote-desktop-mouse.png') });
  const left = await page.getByRole('button', { name: '鼠标左键', exact: true }).boundingBox();
  await page.mouse.move(left!.x + left!.width / 2, left!.y + left!.height / 2);
  await page.mouse.down();
  await expect(page.getByText('拖拽中', { exact: true })).toBeVisible();
  await page.mouse.up();
  const pad = await page.locator('.rd-pad').boundingBox();
  await page.mouse.move(pad!.x + 20, pad!.y + 35); await page.mouse.down();
  await page.mouse.move(pad!.x + 55, pad!.y + 50); await page.mouse.up();
  await expect.poll(() => page.evaluate(() => window.desktopTest.inputs.at(-1)?.kind)).toBe('move');
  await page.getByRole('button', { name: '鼠标左键', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.desktopTest.inputs.at(-1)))
    .toEqual({ kind: 'button', button: 'left', down: false });
  await page.getByRole('button', { name: '显示', exact: true }).click();
  await expect(page.getByRole('group', { name: '帧率', exact: true }).getByRole('button', { name: '自动' }))
    .toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('spinbutton', { name: '自定义帧率' }).fill('45');
  await page.getByRole('button', { name: '应用帧率' }).click();
  await page.getByRole('button', { name: '高清', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.desktopTest.settings.at(-1)))
    .toEqual({ fps: 45, quality: 'clear' });
  const panelWidth = await page.getByRole('complementary', { name: '显示设置' }).evaluate(node => node.clientWidth);
  expect(panelWidth).toBeLessThanOrEqual(400);
  await page.screenshot({ path: info.outputPath('remote-desktop-display.png') });
  await page.getByRole('button', { name: '完成', exact: true }).click();
  await page.getByRole('button', { name: '键盘', exact: true }).click();
  await page.getByRole('textbox', { name: '发送到电脑的文字' }).fill('你好，远程桌面');
  await page.getByRole('button', { name: '发送', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.desktopTest.inputs.at(-1)))
    .toEqual({ kind: 'text', text: '你好，远程桌面' });
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect.poll(() => page.evaluate(() => window.desktopTest.closed)).toBe(1);
  expect(await page.evaluate(() => window.desktopTest.maxConcurrent)).toBe(1);
  expect(errors).toEqual([]);
});

test('follows the local pointer, collapses when idle and maps direct touches through the video', async ({ page }, info) => {
  await page.goto('e2e/remote-desktop-harness.html');
  await page.getByRole('button', { name: '打开工具' }).click();
  await page.getByRole('button', { name: '远程桌面', exact: true }).click();
  await expect.poll(() => page.locator('video').evaluate(video => video.videoWidth)).toBeGreaterThan(0);
  await expect(page.getByText('正在连接桌面…')).not.toBeVisible();
  const stage = (await page.locator('.rd-stage').boundingBox())!;
  const cursor = (await page.locator('.rd-cursor').boundingBox())!;
  const beforePanel = (await page.locator('.rd-mouse').boundingBox())!;
  expect(beforePanel.width).toBe(144); expect(beforePanel.height).toBe(160);
  await page.mouse.move(stage.x + 15, stage.y + 20); await page.mouse.down();
  await page.mouse.move(stage.x + 45, stage.y + 45); await page.mouse.up();
  const moved = (await page.locator('.rd-cursor').boundingBox())!;
  expect(moved.x - cursor.x).toBeCloseTo(30, 0); expect(moved.y - cursor.y).toBeCloseTo(25, 0);
  const movedPanel = (await page.locator('.rd-mouse').boundingBox())!;
  expect(movedPanel.x !== beforePanel.x || movedPanel.y !== beforePanel.y).toBe(true);
  await page.mouse.move(stage.x + 15, stage.y + 20); await page.mouse.down();
  await page.mouse.move(stage.x + 15, stage.y + stage.height - 10); await page.mouse.up();
  const edgePanel = (await page.locator('.rd-mouse').boundingBox())!;
  expect(edgePanel.y + edgePanel.height).toBeLessThanOrEqual(stage.y + stage.height);
  const videoHeight = Math.min(stage.height, stage.width * 9 / 16);
  const videoBottom = stage.y + (stage.height + videoHeight) / 2;
  if (stage.height - videoHeight > 20) expect(edgePanel.y + edgePanel.height).toBeGreaterThan(videoBottom);
  await page.screenshot({ path: info.outputPath('mouse-follows-at-edge.png') });
  const icon = page.getByRole('button', { name: '展开鼠标面板' });
  await expect(icon).toBeVisible({ timeout: 6500 });
  await expect(page.locator('.rd-mouse')).toHaveCount(0);
  await page.screenshot({ path: info.outputPath('mouse-idle-icon.png') });
  await icon.click(); await expect(page.locator('.rd-mouse')).toBeVisible();
  const left = (await page.getByRole('button', { name: '鼠标左键', exact: true }).boundingBox())!;
  await page.mouse.move(left.x + left.width / 2, left.y + left.height / 2); await page.mouse.down();
  await expect(page.getByText('拖拽中', { exact: true })).toBeVisible(); await page.mouse.up();
  await page.waitForTimeout(4200); await expect(page.locator('.rd-mouse')).toBeVisible();
  await page.getByRole('button', { name: '触屏', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.desktopTest.inputs.at(-1)))
    .toEqual({ kind: 'button', button: 'left', down: false });
  await expect(page.locator('.rd-mouse-layer')).toHaveCount(0);
  await page.evaluate(() => { window.desktopTest.inputs.length = 0; });
  const scale = Math.min(stage.width / 1600, stage.height / 900);
  const width = 1600 * scale; const height = 900 * scale;
  const leftEdge = stage.x + (stage.width - width) / 2; const topEdge = stage.y + (stage.height - height) / 2;
  await page.mouse.click(leftEdge + (width - 1) * 0.25, topEdge + (height - 1) * 0.7);
  await expect.poll(() => page.evaluate(() => window.desktopTest.inputs.at(-1)))
    .toEqual({ kind: 'button', button: 'left', down: false });
  const inputs = await page.evaluate(() => window.desktopTest.inputs);
  const move = inputs.find(input => input.kind === 'move');
  expect(move?.kind).toBe('move');
  if (move?.kind === 'move') { expect(move.x).toBeCloseTo(0.25, 2); expect(move.y).toBeCloseTo(0.7, 2); }
  expect(inputs.filter(input => input.kind === 'button')).toEqual([
    { kind: 'button', button: 'left', down: true }, { kind: 'button', button: 'left', down: false },
  ]);
  const count = inputs.length;
  // Each configured viewport has either horizontal or vertical letterboxing.
  await page.mouse.click(stage.x + 2, stage.y + 2);
  await page.waitForTimeout(150);
  expect(await page.evaluate(() => window.desktopTest.inputs.length)).toBe(count);
  await page.screenshot({ path: info.outputPath('direct-touch.png') });
  await page.getByRole('button', { name: '鼠标', exact: true }).click();
  await expect(page.locator('.rd-mouse')).toBeVisible();
  await page.getByRole('button', { name: '关闭', exact: true }).click();
});
