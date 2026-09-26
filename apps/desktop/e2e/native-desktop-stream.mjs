import { chromium } from '@playwright/test';

const { CSW_NATIVE_TEST_ENDPOINT: endpoint, CSW_NATIVE_TEST_TOKEN: token } = process.env;
if (!endpoint?.startsWith('http://127.0.0.1:') || !token) throw new Error('Local native test harness required');
const browser = await chromium.launch({ channel: 'msedge', headless: true,
  args: process.env.CSW_NATIVE_TEST_CA_BASE64 ? ['--ignore-certificate-errors'] : [] });
try {
  const page = await browser.newPage();
  await page.exposeFunction('nativeRequest', async (path, body) => {
    const response = await fetch(`${endpoint}${path}`, { method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Desktop-Test': token }, body: JSON.stringify(body ?? {}) });
    if (!response.ok) throw new Error(`Native harness failed: ${response.status}`);
    return response.json();
  });
  const iceServers = JSON.parse(process.env.CSW_NATIVE_TEST_ICE || '[]');
  const result = await page.evaluate(async iceServers => {
    const offer = await window.nativeRequest('/offer');
    const peer = new RTCPeerConnection({ iceServers, iceTransportPolicy: iceServers.length ? 'relay' : 'all' });
    const video = document.createElement('video'); video.muted = true; video.autoplay = true;
    document.body.append(video);
    const pending = [];
    let timer;
    peer.onicecandidate = ({ candidate }) => { if (candidate) pending.push(candidate.toJSON()); };
    peer.ontrack = ({ streams }) => { video.srcObject = streams[0]; };
    peer.ondatachannel = ({ channel }) => {
      channel.onopen = () => {
        channel.send('{"kind":"ping"}');
        timer = setInterval(() => { if (channel.readyState === 'open') channel.send('{"kind":"ping"}'); }, 1000);
      };
    };
    await peer.setRemoteDescription({ type: 'offer', sdp: offer.sdp });
    const answer = await peer.createAnswer(); await peer.setLocalDescription(answer);
    let answerSdp = answer.sdp;
    const started = performance.now();
    while (performance.now() - started < 20_000) {
      const response = await window.nativeRequest('/signal', { answer: answerSdp, candidates: pending.splice(0) });
      answerSdp = undefined;
      for (const candidate of response.candidates) await peer.addIceCandidate(candidate);
      if (video.videoWidth > 0 && video.getVideoPlaybackQuality().totalVideoFrames >= 20) break;
      await new Promise(resolve => setTimeout(resolve, 150));
    }
    const first = video.getVideoPlaybackQuality().totalVideoFrames;
    const sampleStart = performance.now();
    await new Promise(resolve => setTimeout(resolve, 5000));
    const sample = { connected: peer.connectionState, width: video.videoWidth, height: video.videoHeight,
      frames: video.getVideoPlaybackQuality().totalVideoFrames - first,
      fps: (video.getVideoPlaybackQuality().totalVideoFrames - first) * 1000 / (performance.now() - sampleStart) };
    const stats = await peer.getStats();
    const transport = [...stats.values()].find(item => item.type === 'transport' && item.selectedCandidatePairId);
    const pair = transport && stats.get(transport.selectedCandidatePairId);
    sample.candidateType = pair && stats.get(pair.localCandidateId)?.candidateType;
    clearInterval(timer); peer.close(); return sample;
  }, iceServers);
  console.log(JSON.stringify(result));
  if (result.connected !== 'connected' || result.width === 0 || result.frames < 20) throw new Error('Native video failed');
  if (iceServers.length && result.candidateType !== 'relay') throw new Error('Native relay bypassed');
} finally { await browser.close(); }
