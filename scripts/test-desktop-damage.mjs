import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { prepareDesktopVideoRuntime } from './prepare-remote-desktop-runtime.mjs';

await prepareDesktopVideoRuntime();
const runtime = resolve('apps/desktop/src-tauri/resources/remote-desktop/runtime');
const fixture = resolve('.codex-tmp/remote-desktop-runtime/native-build/Release/desktop-video-fixture.exe');
const frameSize = 640 * 360 * 3;

function isRecoveryFrame(packet) {
  const types = new Set();
  for (let index = 0; index + 3 < packet.length; index++) {
    if (packet[index] === 0 && packet[index + 1] === 0 && packet[index + 2] === 1)
      types.add(packet[index + 3] & 31);
  }
  return [5, 7, 8].every(type => types.has(type));
}

function decoder() {
  const phases = [];
  const child = spawn(resolve(runtime, 'ffmpeg.exe'), ['-hide_banner', '-loglevel', 'error',
    '-f', 'h264', '-i', 'pipe:0', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-fps_mode', 'passthrough', 'pipe:1'],
  { windowsHide: true });
  let buffer = Buffer.alloc(0), frames = 0, marker = false, patch = false, restored = false;
  child.stdout.on('data', data => {
    buffer = Buffer.concat([buffer, data]);
    while (buffer.length >= frameSize) {
      const red = (25 * 640 + 25) * 3, update = (187 * 640 + 257) * 3;
      marker ||= buffer[red] > 150 && buffer[red + 1] < 90;
      if (phases[frames] === 4 && buffer[update] > 180 && buffer[red] > 150) patch = true;
      if (phases[frames] === 5 && patch && buffer[update] < 90) restored = true;
      frames++;
      buffer = buffer.subarray(frameSize);
    }
  });
  child.stderr.on('data', data => process.stderr.write(data));
  const done = new Promise((resolveDone, reject) => {
    child.on('error', reject);
    child.on('exit', code => code === 0 ? resolveDone({ frames, marker, patch, restored })
      : reject(new Error(`Decoder failed: ${code}`)));
  });
  return { child, done, phases };
}

async function measure(backend, baseline) {
  const output = decoder();
  const recovery = decoder();
  let recovering = false;
  const child = spawn(fixture, [backend, baseline ? 'baseline' : 'damage'],
    { windowsHide: true, env: { ...process.env, PATH: `${runtime};${process.env.PATH}` } });
  const phases = Array.from({ length: 6 }, () => ({ frames: 0, bytes: 0 }));
  let phase = 0, buffer = Buffer.alloc(0), stderr = '';
  const started = performance.now();
  let firstFrameMs;
  child.stderr.on('data', data => {
    stderr += data;
    for (const match of String(data).matchAll(/phase=(\d)/g)) phase = Number(match[1]);
  });
  child.stdout.on('data', data => {
    buffer = Buffer.concat([buffer, data]);
    while (buffer.length >= 4 && buffer.length >= 4 + buffer.readUInt32LE(0)) {
      const length = buffer.readUInt32LE(0);
      const packet = buffer.subarray(4, 4 + length);
      firstFrameMs ??= performance.now() - started;
      phases[phase].frames++;
      phases[phase].bytes += length;
      output.phases.push(phase);
      output.child.stdin.write(packet);
      if (phase >= 3 && isRecoveryFrame(packet)) recovering = true;
      if (recovering) { recovery.phases.push(phase); recovery.child.stdin.write(packet); }
      buffer = buffer.subarray(4 + length);
    }
  });
  const timer = setTimeout(() => child.kill(), 25_000);
  try {
    const code = await new Promise((done, reject) => { child.on('exit', done); child.on('error', reject); });
    assert.equal(code, 0, stderr);
    assert.equal(buffer.length, 0, 'complete length-delimited output');
    assert.ok(firstFrameMs < 2000, `First frame must not wait for later damage: ${firstFrameMs} ms`);
    output.child.stdin.end();
    recovery.child.stdin.end();
    const decoded = await output.done;
    assert.ok(decoded.frames > 30 && decoded.marker && decoded.patch && decoded.restored,
      `Decoded updates and erasure: ${JSON.stringify(decoded)}`);
    const resumed = await recovery.done;
    assert.ok(resumed.frames >= 3 && resumed.marker && resumed.patch && resumed.restored,
      `A new decoder must recover after idle without earlier frames: ${JSON.stringify(resumed)}`);
    console.log(JSON.stringify({ backend, baseline, firstFrameMs, phases, decoded, resumed }));
    return phases;
  } finally { clearTimeout(timer); child.kill(); output.child.kill(); recovery.child.kill(); }
}

for (const backend of ['gpu', 'gdi']) {
  const baseline = await measure(backend, true);
  const damage = await measure(backend, false);
  assert.ok(damage[3].frames <= 3, `${backend}: quiet desktop must stop repeated video frames`);
  assert.ok(damage[3].bytes < baseline[3].bytes, `${backend}: quiet media bytes must decrease`);
  assert.ok(damage[1].frames < baseline[1].frames / 2, `${backend}: local updates must coalesce`);
  assert.ok(damage[2].frames >= 50, `${backend}: moving content must remain live`);
}
