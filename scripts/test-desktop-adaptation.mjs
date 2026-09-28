import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { prepareDesktopVideoRuntime } from './prepare-remote-desktop-runtime.mjs';

await prepareDesktopVideoRuntime();
const runtime = resolve('apps/desktop/src-tauri/resources/remote-desktop/runtime');
const fixture = resolve('.codex-tmp/remote-desktop-runtime/native-build/Release/desktop-video-fixture.exe');

async function measure(backend) {
  const sender = spawn(fixture, [backend, 'baseline', 'rate'], {
    windowsHide: true, env: { ...process.env, PATH: `${runtime};${process.env.PATH}` },
  });
  const decoder = spawn(resolve(runtime, 'ffmpeg.exe'), ['-hide_banner', '-loglevel', 'error',
    '-f', 'h264', '-i', 'pipe:0', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'], { windowsHide: true });
  let encoded = Buffer.alloc(0), decoded = 0, log = '', frames = 0;
  let lowBytes = 0, highBytes = 0;
  const started = performance.now();
  sender.stderr.on('data', data => { log += data; });
  decoder.stderr.on('data', data => { log += data; });
  decoder.stdout.on('data', data => { decoded += data.length; });
  sender.stdout.on('data', data => {
    encoded = Buffer.concat([encoded, data]);
    while (encoded.length >= 4 && encoded.length >= 4 + encoded.readUInt32LE(0)) {
      const length = encoded.readUInt32LE(0);
      assert.ok(length > 0 && length <= 8 * 1024 * 1024);
      decoder.stdin.write(encoded.subarray(4, 4 + length)); frames++;
      const elapsed = performance.now() - started;
      if (elapsed > 1000 && elapsed < 2000) highBytes += length;
      if (elapsed > 3500 && elapsed < 4500) lowBytes += length;
      encoded = encoded.subarray(4 + length);
    }
  });
  const command = (bitrate, fps) => {
    const bytes = Buffer.alloc(12);
    bytes.writeUInt32LE(0x32575343, 0); bytes.writeUInt32LE(bitrate, 4); bytes.writeUInt32LE(fps, 8);
    sender.stdin.write(bytes);
  };
  const timers = [setTimeout(() => command(400_000, 15), 2200),
    setTimeout(() => command(3_000_000, 60), 4800), setTimeout(() => command(0, 0), 6000)];
  const exit = child => new Promise((resolveExit, reject) => {
    child.once('error', reject); child.once('exit', code => resolveExit(code));
  });
  const decodedExit = exit(decoder);
  const timeout = setTimeout(() => { sender.kill(); decoder.kill(); }, 20_000);
  try {
    assert.equal(await exit(sender), 0, log);
    decoder.stdin.end(); assert.equal(await decodedExit, 0, log);
    assert.equal(encoded.length, 0);
    assert.ok(frames > 100 && decoded > 640 * 360 * 3 * 100, 'Video must continue decoding through updates');
    assert.ok(log.includes('controlApplied fps=15') && log.includes('controlApplied fps=60'), log);
    assert.ok(lowBytes < highBytes, `Rate reduction must affect real output: ${lowBytes} >= ${highBytes}`);
    console.log(JSON.stringify({ backend, frames, highBytes, lowBytes, sameProcess: true }));
  } finally {
    timers.forEach(clearTimeout); clearTimeout(timeout); sender.kill(); decoder.kill();
  }
}
await measure('gpu');
await measure('gdi');
