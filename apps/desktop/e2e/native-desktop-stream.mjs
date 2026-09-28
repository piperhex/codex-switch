import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const { CSW_NATIVE_TEST_ENDPOINT: endpoint, CSW_NATIVE_TEST_TOKEN: token } = process.env;
if (!endpoint?.startsWith('http://127.0.0.1:') || !token) throw new Error('Local native test harness required');
const animation = process.env.CSW_NATIVE_TEST_MOVING ? spawn(fileURLToPath(new URL(
  '../../../.codex-tmp/remote-desktop-runtime/native-build/Release/desktop-video-fixture.exe', import.meta.url)),
['--animate'], { windowsHide: true, stdio: 'ignore', env: { ...process.env,
  PATH: `${fileURLToPath(new URL('../src-tauri/resources/remote-desktop/runtime', import.meta.url))};${process.env.PATH}`,
} }) : undefined;
let animationError;
animation?.on('error', error => { animationError = error; });
const audioFixture = spawn(fileURLToPath(new URL(
  '../../../.codex-tmp/remote-desktop-runtime/native-build/Release/desktop-audio-fixture.exe', import.meta.url)),
[], { windowsHide: true, stdio: ['ignore', 'ignore', 'inherit'], env: { ...process.env,
  PATH: `${fileURLToPath(new URL('../src-tauri/resources/remote-desktop/runtime', import.meta.url))};${process.env.PATH}`,
} });
let audioError;
audioFixture.on('error', error => { audioError = error; });
audioFixture.on('exit', code => { audioError ??= new Error(`Audio fixture exited: ${code}`); });
let browser;
try {
  browser = await chromium.launch({ channel: 'msedge', headless: true,
    args: ['--autoplay-policy=no-user-gesture-required',
      ...(process.env.CSW_NATIVE_TEST_CA_BASE64 ? ['--ignore-certificate-errors'] : [])] });
  const page = await browser.newPage();
  await page.exposeFunction('nativeRequest', async (path, body) => {
    const response = await fetch(`${endpoint}${path}`, { method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Desktop-Test': token }, body: JSON.stringify(body ?? {}) });
    if (!response.ok) throw new Error(`Native harness failed: ${response.status}`);
    return response.json();
  });
  const iceServers = JSON.parse(process.env.CSW_NATIVE_TEST_ICE || '[]');
  const result = await page.evaluate(async iceServers => {
    const sound = new AudioContext();
    await sound.resume();
    const offer = await window.nativeRequest('/offer');
    const peer = new RTCPeerConnection({ iceServers, iceTransportPolicy: iceServers.length ? 'relay' : 'all' });
    const video = document.createElement('video'); video.muted = true; video.autoplay = true;
    document.body.append(video);
    const pending = [];
    let receivedSound;
    const analyser = sound.createAnalyser(); analyser.fftSize = 2048;
    const silent = sound.createGain(); silent.gain.value = 0; silent.connect(sound.destination);
    let timer;
    peer.onicecandidate = ({ candidate }) => { if (candidate) pending.push(candidate.toJSON()); };
    peer.ontrack = ({ streams, track }) => {
      video.srcObject = streams[0];
      if (track.kind === 'audio') {
        // Pull decoded audio without feeding the remote sound back into this machine's loopback capture.
        receivedSound = sound.createMediaStreamSource(new MediaStream([track]));
        receivedSound.connect(analyser); analyser.connect(silent);
      }
    };
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
      if (video.videoWidth > 0 && video.getVideoPlaybackQuality().totalVideoFrames >= 1) break;
      await new Promise(resolve => setTimeout(resolve, 150));
    }
    const first = video.getVideoPlaybackQuality().totalVideoFrames;
    const sampleStart = performance.now();
    await new Promise(resolve => setTimeout(resolve, 5000));
    const sample = { connected: peer.connectionState, width: video.videoWidth, height: video.videoHeight,
      frames: video.getVideoPlaybackQuality().totalVideoFrames - first,
      fps: (video.getVideoPlaybackQuality().totalVideoFrames - first) * 1000 / (performance.now() - sampleStart) };
    const stats = await peer.getStats();
    const audio = [...stats.values()].find(item => item.type === 'inbound-rtp' && item.kind === 'audio');
    sample.audioPackets = audio?.packetsReceived ?? 0;
    sample.audioSamples = audio?.totalSamplesReceived ?? 0;
    sample.audioConcealed = audio?.concealedSamples ?? 0;
    sample.audioJitter = audio?.jitter;
    sample.audioBytes = audio?.bytesReceived;
    // Audio-level RTP extensions are optional; inspect decoded PCM rather than relying on totalAudioEnergy.
    const samples = new Float32Array(analyser.fftSize); analyser.getFloatTimeDomainData(samples);
    sample.audioPeak = Math.max(...samples.map(Math.abs));
    const transport = [...stats.values()].find(item => item.type === 'transport' && item.selectedCandidatePairId);
    const pair = transport && stats.get(transport.selectedCandidatePairId);
    sample.candidateType = pair && stats.get(pair.localCandidateId)?.candidateType;
    clearInterval(timer); peer.close(); await sound.close(); return sample;
  }, iceServers);
  console.log(JSON.stringify(result));
  if (audioError) throw audioError;
  // Idle desktops only send periodic recovery frames; a high frame count requires a moving source.
  if (result.connected !== 'connected' || result.width === 0 || result.frames < 1) throw new Error('Native video failed');
  if (result.audioPackets < 100 || result.audioSamples < 48_000 || result.audioPeak <= 0.00001) {
    throw new Error('Native system sound did not reach the browser decoder');
  }
  if (iceServers.length && result.candidateType !== 'relay') throw new Error('Native relay bypassed');
  if (animationError) throw animationError;
  if (process.env.CSW_NATIVE_TEST_MIN_FPS && result.fps < Number(process.env.CSW_NATIVE_TEST_MIN_FPS)) {
    throw new Error(`Native playback was only ${result.fps.toFixed(1)} FPS`);
  }
} finally { animation?.kill(); audioFixture.kill(); await browser?.close(); }
