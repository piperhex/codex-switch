// Open a bottom sheet on the disposable emulator before running this pixel-level regression check.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { adb, output } from './android-chat-driver.mjs';

const exec = promisify(execFile);
const RECORD_SECONDS = 5;
const STRIP_WIDTH = 8;
const WHITE_THRESHOLD = 235;
const EDGE_TOLERANCE = 1;
const remoteVideo = '/sdcard/codex-sheet-stability.mp4';
const report = { passed: false };

async function readFrames(video) {
  const probe = await exec('ffprobe', ['-v', 'error', '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height:format=duration', '-of', 'json', video]);
  const { streams: [size], format } = JSON.parse(probe.stdout);
  const x = Math.floor(size.width / 10);
  const filter = `crop=${STRIP_WIDTH}:${size.height}:${x}:0,format=gray`;
  const { stdout } = await exec('ffmpeg', ['-v', 'error', '-i', video, '-vf', filter,
    '-fps_mode', 'passthrough', '-f', 'rawvideo', '-'], { encoding: 'buffer', maxBuffer: 16 * 1024 * 1024 });
  return { pixels: stdout, height: size.height, duration: Number(format.duration) };
}

function sheetTop(frame, height) {
  // The modal backdrop darkens the page; the sheet itself is white. Probe inside its rounded corner.
  for (let y = Math.floor(height * 0.05); y < height * 0.95; y++) {
    const row = frame.subarray(y * STRIP_WIDTH, (y + 1) * STRIP_WIDTH);
    if (row.every(pixel => pixel >= WHITE_THRESHOLD)) return y;
  }
  throw new Error('No white sheet edge found. Open the answer drawer before running this check.');
}

try {
  await mkdir(output, { recursive: true });
  const video = process.env.ANDROID_SHEET_VIDEO ?? path.join(output, 'sheet-stability.mp4');
  let recordedSeconds = 0;
  if (!process.env.ANDROID_SHEET_VIDEO) {
    const started = Date.now();
    await adb('shell', 'screenrecord', '--time-limit', String(RECORD_SECONDS), remoteVideo);
    recordedSeconds = (Date.now() - started) / 1000;
    await adb('pull', remoteVideo, video);
  }
  const { pixels, height, duration } = await readFrames(video);
  // Android omits unchanged frames, so a stable screen can produce a shorter encoded video.
  const observedSeconds = Math.max(recordedSeconds, duration);
  assert.ok(observedSeconds >= RECORD_SECONDS - 1, 'record the full observation window');
  const frameBytes = height * STRIP_WIDTH;
  const tops = [];
  for (let offset = 0; offset < pixels.length; offset += frameBytes) {
    tops.push(sheetTop(pixels.subarray(offset, offset + frameBytes), height));
  }
  assert.ok(tops.length, 'recorded at least one displayed frame');
  assert.ok(tops.every(top => top > height * 0.08), 'a dimmed backdrop must be visible above the sheet');
  const drift = Math.max(...tops) - Math.min(...tops);
  Object.assign(report, { frames: tops.length, positions: [...new Set(tops)], drift, observedSeconds });
  assert.ok(drift <= EDGE_TOLERANCE, `sheet edge moved ${drift}px while idle`);
  report.passed = true;
  console.log(`PASS: ${tops.length} frames, sheet edge drift ${drift}px`);
} catch (error) {
  report.error = String(error);
  throw error;
} finally {
  await writeFile(path.join(output, 'sheet-stability.json'), JSON.stringify(report, null, 2));
}
