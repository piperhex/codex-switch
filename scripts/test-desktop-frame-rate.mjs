import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { prepareDesktopVideoRuntime } from './prepare-remote-desktop-runtime.mjs';

await prepareDesktopVideoRuntime();
const runtime = resolve('apps/desktop/src-tauri/resources/remote-desktop/runtime');
const fixture = resolve('.codex-tmp/remote-desktop-runtime/native-build/Release/desktop-video-fixture.exe');

async function measure(backend) {
  const decoder = spawn(resolve(runtime, 'ffmpeg.exe'), ['-hide_banner', '-loglevel', 'error',
    '-f', 'h264', '-i', 'pipe:0', '-progress', 'pipe:1', '-f', 'null', '-'], { windowsHide: true });
  const child = spawn(fixture, [backend, process.env.CSW_VIDEO_BASELINE ? 'baseline' : 'damage', 'rate'], {
    windowsHide: true, env: { ...process.env, PATH: `${runtime};${process.env.PATH}` },
  });
  let buffer = Buffer.alloc(0), output = '', errors = '', frames = 0, measured = 0, first;
  decoder.stdout.on('data', data => { output += data; });
  decoder.stderr.on('data', data => { errors += data; });
  child.stderr.on('data', data => { errors += data; });
  child.stdout.on('data', data => {
    buffer = Buffer.concat([buffer, data]);
    while (buffer.length >= 4 && buffer.length >= 4 + buffer.readUInt32LE(0)) {
      const size = buffer.readUInt32LE(0), now = performance.now();
      first ??= now;
      const elapsed = now - first;
      if (elapsed >= 1000 && elapsed < 7000) measured++;
      frames++;
      decoder.stdin.write(buffer.subarray(4, 4 + size));
      buffer = buffer.subarray(4 + size);
    }
  });
  const completion = process => new Promise((done, reject) => {
    process.once('error', reject); process.once('exit', code => done(code));
  });
  const decoded = completion(decoder), finished = completion(child);
  const timeout = setTimeout(() => { child.kill(); decoder.kill(); }, 20_000);
  try {
    assert.equal(await finished, 0, errors);
    decoder.stdin.end();
    assert.equal(await decoded, 0, errors);
    const decodedFrames = Number([...output.matchAll(/^frame=(\d+)/gm)].at(-1)?.[1]);
    assert.equal(buffer.length, 0, 'Complete access units');
    assert.equal(decodedFrames, frames, 'Every encoded frame must decode');
    assert.ok(frames > 30, errors);
    const result = { backend, requestedFps: 60, sourceUpdatesPerSecond: 144, measuredFps: measured / 6,
      frames, decodedFrames, encoder: errors.match(/encoder=(\S+)/)?.[1],
      diagnostics: errors.split(/\r?\n/).filter(line => /Polls=/.test(line)) };
    console.log(JSON.stringify(result));
    if (process.env.CSW_VIDEO_MIN_FPS) assert.ok(result.measuredFps >= Number(process.env.CSW_VIDEO_MIN_FPS));
  } finally { clearTimeout(timeout); child.kill(); decoder.kill(); }
}

for (const backend of ['gpu', 'gdi']) await measure(backend);
