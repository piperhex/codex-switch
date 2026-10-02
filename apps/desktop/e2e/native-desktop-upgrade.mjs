import { chromium, expect } from '@playwright/test';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const { CSW_NATIVE_TEST_ENDPOINT: endpoint, CSW_NATIVE_TEST_TOKEN: token } = process.env;
if (!endpoint?.startsWith('http://127.0.0.1:') || !token) throw new Error('Local native harness required');
const bundle = await build({ entryPoints: [fileURLToPath(new URL('../../../shared/remote-desktop/receiver.ts',
  import.meta.url))], bundle: true, write: false, format: 'iife', globalName: 'DesktopReceiverModule' });
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const page = await browser.newPage();
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  let lostCommit = false;
  await page.exposeFunction('nativeRequest', async (path, body) => {
    const response = await fetch(`${endpoint}${path}`, { method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Desktop-Test': token }, body: JSON.stringify(body ?? {}) });
    if (!response.ok) throw new Error(`Native test bridge: ${response.status}`);
    const reply = await response.json();
    if (body?.directUpgrade?.action === 'commit' && !lostCommit) {
      lostCommit = true; throw new Error('Simulated lost commit acknowledgement');
    }
    return reply;
  });
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  await page.evaluate(async iceServers => {
    const video = document.createElement('video'); video.autoplay = true; video.muted = true;
    document.body.append(video);
    const state = window.upgradeTest = { peers: [], routes: [], stats: {}, streams: 0, failures: [] };
    state.receiver = new window.DesktopReceiverModule.DesktopReceiver({
      client: { open: async () => ({ ...await window.nativeRequest('/offer'), iceServers }),
        signal: (_id, signal) => window.nativeRequest('/signal', signal),
        close: async () => {}, settings: async () => {} },
      createPeer: configuration => {
        const peer = new RTCPeerConnection({ ...configuration,
          iceTransportPolicy: state.peers.length ? 'all' : 'relay' });
        state.peers.push(peer); return peer;
      },
      stream: stream => { video.srcObject = stream ?? null; if (stream) state.streams++; },
      stats: stats => { state.stats = stats; if (stats.connection) state.routes.push(stats.connection); },
      status: () => {}, failed: message => state.failures.push(message),
    });
    await state.receiver.start({ fps: 'auto', quality: 'smooth' });
  }, JSON.parse(process.env.CSW_NATIVE_TEST_ICE || '[]'));
  await expect.poll(() => page.evaluate(() => window.upgradeTest.routes.includes('relay')),
    { timeout: 25_000 }).toBe(true);
  await expect.poll(() => page.evaluate(() => window.upgradeTest.stats.connection),
    { timeout: 40_000 }).toBe('direct');
  await expect.poll(() => page.evaluate(() => window.upgradeTest.peers[0].connectionState)).toBe('closed');
  const video = page.locator('video');
  const frames = await video.evaluate(element => element.getVideoPlaybackQuality().totalVideoFrames);
  await expect.poll(() => video.evaluate(element => element.getVideoPlaybackQuality().totalVideoFrames),
    { timeout: 10_000 }).toBeGreaterThan(frames);
  const result = await page.evaluate(() => ({ routes: [...new Set(window.upgradeTest.routes)],
    peers: window.upgradeTest.peers.length, streams: window.upgradeTest.streams,
    failures: window.upgradeTest.failures, width: document.querySelector('video').videoWidth }));
  expect(result.failures).toEqual([]); expect(result.peers).toBe(2); expect(errors).toEqual([]);
  expect(lostCommit).toBe(true);
  await page.evaluate(() => window.upgradeTest.receiver.stop());
  console.log(JSON.stringify(result));
} finally { await browser.close(); }
