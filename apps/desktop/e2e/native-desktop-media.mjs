// Invoked by the Rust media adapter integration test; all endpoints are ephemeral and local.
import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';

let input = '';
for await (const chunk of process.stdin) input += chunk;
const endpoints = JSON.parse(input);
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const deadline = setTimeout(() => { void browser.close(); }, 45_000);
try {
  const page = await browser.newPage();
  await page.setContent('<canvas width="320" height="180"></canvas><video autoplay muted></video>');
  const result = await page.evaluate(async ([hostEndpoint, viewerEndpoint]) => {
    const peers = [hostEndpoint, viewerEndpoint].map(endpoint => new RTCPeerConnection({
      iceServers: [endpoint], iceTransportPolicy: 'relay',
    }));
    const [host, viewer] = peers;
    const iceErrors = [];
    peers.forEach(peer => { peer.onicecandidateerror = event => iceErrors.push({ code: event.errorCode,
      text: event.errorText }); });
    const canvas = document.querySelector('canvas');
    const paint = canvas.getContext('2d');
    const video = document.querySelector('video');
    const media = canvas.captureStream(30);
    const audio = new AudioContext();
    const output = audio.createMediaStreamDestination();
    const tone = audio.createOscillator(); tone.connect(output); tone.start(); await audio.resume();
    for (const track of [...media.getTracks(), ...output.stream.getTracks()]) host.addTrack(track, media);
    const controls = host.createDataChannel('remote-desktop-controls');
    let receivedControl = '';
    viewer.ondatachannel = event => { event.channel.onmessage = message => { receivedControl = message.data; }; };
    viewer.ontrack = event => { video.srcObject = event.streams[0]; void video.play(); };
    const gather = peer => new Promise(resolve => {
      if (peer.iceGatheringState === 'complete') resolve();
      else peer.addEventListener('icegatheringstatechange', () => {
        if (peer.iceGatheringState === 'complete') resolve();
      });
    });
    await host.setLocalDescription(await host.createOffer()); await gather(host);
    await viewer.setRemoteDescription(host.localDescription);
    await viewer.setLocalDescription(await viewer.createAnswer()); await gather(viewer);
    await host.setRemoteDescription(viewer.localDescription);
    const started = Date.now();
    let receivedVideo = 0; let receivedAudio = 0; let selected;
    while (Date.now() - started < 20_000) {
      paint.fillStyle = `hsl(${Date.now() % 360}, 80%, 50%)`; paint.fillRect(0, 0, canvas.width, canvas.height);
      if (controls.readyState === 'open') controls.send('native controls');
      const reports = await viewer.getStats();
      for (const report of reports.values()) {
        if (report.type === 'inbound-rtp' && report.kind === 'video') receivedVideo = report.framesDecoded;
        if (report.type === 'inbound-rtp' && report.kind === 'audio') receivedAudio = report.packetsReceived;
        if (report.type === 'transport' && report.selectedCandidatePairId) {
          const pair = reports.get(report.selectedCandidatePairId);
          selected = { local: reports.get(pair.localCandidateId)?.address,
            remote: reports.get(pair.remoteCandidateId)?.address };
        }
      }
      if (receivedVideo > 5 && receivedAudio > 5 && receivedControl) break;
      await new Promise(resolve => setTimeout(resolve, 33));
    }
    const states = peers.map(peer => ({ state: peer.connectionState,
      candidates: peer.localDescription.sdp.split('\r\n').filter(line => line.startsWith('a=candidate:')) }));
    peers.forEach(peer => peer.close()); media.getTracks().forEach(track => track.stop()); await audio.close();
    return { receivedVideo, receivedAudio, receivedControl, selected, states, iceErrors };
  }, endpoints);
  assert(result.receivedVideo > 5, JSON.stringify(result));
  assert(result.receivedAudio > 5, JSON.stringify(result));
  assert.equal(result.receivedControl, 'native controls');
  assert.deepEqual(result.selected, { local: '10.253.0.2', remote: '10.253.0.1' });
  console.log(JSON.stringify(result));
} finally { clearTimeout(deadline); await browser.close(); }
