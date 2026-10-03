import { chromium, expect } from '@playwright/test';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const { CSW_NATIVE_TEST_ENDPOINT: endpoint, CSW_NATIVE_TEST_TOKEN: token } = process.env;
const standby = process.env.CSW_NATIVE_TEST_STANDBY === '1';
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
  await page.evaluate(async ({ iceServers, standby }) => {
    const video = document.createElement('video'); video.autoplay = true; video.muted = true;
    document.body.append(video);
    const state = window.upgradeTest = { peers: [], routes: [], stats: {}, streams: 0, failures: [], delayedPings: 0 };
    state.receiver = new window.DesktopReceiverModule.DesktopReceiver({
      client: { open: async () => ({ ...await window.nativeRequest('/offer'), iceServers }),
        signal: (_id, signal) => window.nativeRequest('/signal', signal),
        close: async () => {}, settings: async () => {} },
      createPeer: configuration => {
        const peer = new RTCPeerConnection({ ...configuration,
          iceTransportPolicy: configuration.iceTransportPolicy ?? (state.peers.length ? 'all' : 'relay') });
        if (standby && state.peers.length) peer.addEventListener('datachannel', ({ channel }) => {
          const send = channel.send.bind(channel);
          let delayed = false;
          channel.send = data => {
            if (!delayed && data === '{"kind":"ping"}') {
              delayed = true; state.delayedPings++;
              // Reproduce a fast relay heartbeat reaching the host before the promoted direct path.
              setTimeout(() => { if (channel.readyState === 'open') send(data); }, 500);
              return;
            }
            send(data);
          };
        });
        state.peers.push(peer); return peer;
      },
      stream: stream => { video.srcObject = stream ?? null; if (stream) state.streams++; },
      stats: stats => { state.stats = stats; if (stats.connection) state.routes.push(stats.connection); },
      status: () => {}, failed: message => state.failures.push(message),
    });
    await state.receiver.start({ fps: 'auto', quality: 'smooth' });
  }, { iceServers: JSON.parse(process.env.CSW_NATIVE_TEST_ICE || '[]'), standby });
  await expect.poll(() => page.evaluate(() => window.upgradeTest.routes.includes('relay')),
    { timeout: 25_000 }).toBe(true);
  await expect.poll(() => page.evaluate(() => window.upgradeTest.stats.connection),
    { timeout: 40_000 }).toBe('direct');
  await expect.poll(() => page.evaluate(() => window.upgradeTest.peers[0].connectionState))
    .toBe(standby ? 'connected' : 'closed');
  const video = page.locator('video');
  const frames = await video.evaluate(element => element.getVideoPlaybackQuality().totalVideoFrames);
  await expect.poll(() => video.evaluate(element => element.getVideoPlaybackQuality().totalVideoFrames),
    { timeout: 10_000 }).toBeGreaterThan(frames);
  if (standby) {
    const relayFrames = () => page.evaluate(async () => {
      const stats = await window.upgradeTest.peers[0].getStats();
      return [...stats.values()].find(report => report.type === 'inbound-rtp' && report.kind === 'video')?.framesDecoded ?? 0;
    });
    const paused = await relayFrames();
    await page.waitForTimeout(2500);
    expect(await relayFrames()).toBe(paused);
    await page.evaluate(() => window.upgradeTest.peers[1].close());
    await expect.poll(() => page.evaluate(() => window.upgradeTest.stats.connection), { timeout: 10_000 }).toBe('relay');
    const resumed = await video.evaluate(element => element.getVideoPlaybackQuality().totalVideoFrames);
    await expect.poll(() => video.evaluate(element => element.getVideoPlaybackQuality().totalVideoFrames),
      { timeout: 10_000 }).toBeGreaterThan(resumed + 5);
    await expect.poll(() => page.evaluate(() => window.upgradeTest.stats.connection), { timeout: 40_000 }).toBe('direct');
    expect(await page.evaluate(() => window.upgradeTest.peers[0].connectionState)).toBe('connected');
  }
  const result = await page.evaluate(() => ({ routes: [...new Set(window.upgradeTest.routes)],
    peers: window.upgradeTest.peers.length, streams: window.upgradeTest.streams,
    failures: window.upgradeTest.failures, delayedPings: window.upgradeTest.delayedPings,
    width: document.querySelector('video').videoWidth }));
  expect(result.failures).toEqual([]); expect(result.peers).toBe(standby ? 3 : 2); expect(errors).toEqual([]);
  if (standby) expect(result.delayedPings).toBe(2);
  expect(lostCommit).toBe(true);
  // Host stats are sampled separately from viewer stats; observe them before closing the peer.
  await expect.poll(() => page.evaluate(async () => (await window.nativeRequest('/stats')).connection),
    { timeout: 10_000 }).toBe('direct');
  await page.evaluate(() => window.upgradeTest.receiver.stop());
  console.log(JSON.stringify(result));
} finally { await browser.close(); }
