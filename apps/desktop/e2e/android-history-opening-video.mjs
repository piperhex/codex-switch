import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { adb, output, serial } from './android-chat-driver.mjs';

const exec = promisify(execFile);
const WIDTH = 540;
const HEIGHT = 1212;
const FPS = 30;
const RECORD_SECONDS = 8;
const PIXEL_DIFFERENCE = 30;
const DARK_PIXEL = 200;
const MAX_CHANGED_RATIO = 0.02;
const MIN_CONTENT_PIXELS = 2000;
const RASTER_NOISE_BLUR = 0.65;
const SUBPIXEL_OFFSETS = [-0.5, 0.5];

export async function recordHistoryOpening({ name, open }) {
  const remote = `/sdcard/${name}.mp4`;
  const recording = spawn('adb', ['-s', serial, 'shell', 'screenrecord', '--size', `${WIDTH}x${HEIGHT}`,
    '--bit-rate', '4000000', '--time-limit', String(RECORD_SECONDS), remote], { windowsHide: true });
  const finished = new Promise((resolve, reject) => {
    recording.on('error', reject);
    recording.on('exit', (code) => code === 0 ? resolve() : reject(new Error(`Screen recording failed: ${code}`)));
  });
  let regions;
  try {
    await new Promise((resolve) => setTimeout(resolve, 800));
    regions = await open();
  } finally {
    await finished;
    await adb('pull', remote, path.join(output, `${name}.mp4`));
  }
  return analyzeOpening({ name, regions });
}

function compareRegion({ frame, reference, rect, verticalOffset = 0 }) {
  let changed = 0;
  let dark = 0;
  const [left, top, right, bottom] = rect;
  for (let y = top; y < bottom; y++) {
    const referenceY = Math.floor(y + verticalOffset);
    const fraction = y + verticalOffset - referenceY;
    for (let x = left; x < right; x++) {
      const index = y * WIDTH + x;
      const target = reference[referenceY * WIDTH + x] * (1 - fraction)
        + reference[(referenceY + 1) * WIDTH + x] * fraction;
      if (frame[index] < DARK_PIXEL) dark++;
      if (Math.abs(frame[index] - target) > PIXEL_DIFFERENCE) changed++;
    }
  }
  return { changedRatio: changed / ((right - left) * (bottom - top)), dark };
}

function compareContent(options) {
  const original = compareRegion(options);
  if (original.changedRatio <= MAX_CHANGED_RATIO) return original;
  // Android may settle by one physical pixel; larger reading-position changes must still fail.
  const alternatives = SUBPIXEL_OFFSETS.map((verticalOffset) => compareRegion({ ...options, verticalOffset }));
  const changedRatio = Math.min(original.changedRatio, ...alternatives.map((value) => value.changedRatio));
  return { ...original, changedRatio, unalignedChangedRatio: original.changedRatio };
}

export async function analyzeOpening({ name, regions }) {
  const { stdout } = await exec('ffmpeg', ['-v', 'error', '-i', path.join(output, `${name}.mp4`),
    // Light smoothing avoids treating subpixel font antialiasing as different message content.
    '-t', String(RECORD_SECONDS), '-vf', `fps=${FPS},gblur=sigma=${RASTER_NOISE_BLUR}`,
    '-f', 'rawvideo', '-pix_fmt', 'gray', '-'],
  { encoding: 'buffer', maxBuffer: 250 * 1024 * 1024, windowsHide: true });
  const frameSize = WIDTH * HEIGHT;
  const reference = stdout.subarray(stdout.length - frameSize);
  const frames = [];
  let contentAppeared = false;
  for (let index = 0; index < stdout.length / frameSize; index++) {
    const frame = stdout.subarray(index * frameSize, (index + 1) * frameSize);
    const header = compareRegion({ frame, reference, rect: regions.header });
    const content = compareContent({ frame, reference, rect: regions.content });
    if (header.changedRatio > MAX_CHANGED_RATIO) continue;
    contentAppeared ||= content.dark >= MIN_CONTENT_PIXELS;
    if (contentAppeared) frames.push({ index, timeMs: Math.round(index * 1000 / FPS), ...content });
  }
  const invalid = frames.filter((frame) => frame.changedRatio > MAX_CHANGED_RATIO || frame.dark < MIN_CONTENT_PIXELS);
  const result = { name, regions, messageFrames: frames.length, intermediateFrames: invalid,
    firstMessageTimeMs: frames[0]?.timeMs };
  await writeFile(path.join(output, `${name}-frames.json`), JSON.stringify(result, null, 2));
  assert.ok(frames.length > 0, 'The conversation appears in the recording');
  assert.equal(invalid.length, 0, 'The first visible messages are already at their final reading position');
  return result;
}

export function openingRegions(current) {
  const title = current.find((node) => node.text === '移动端聊天体验');
  const list = current.find((node) => node.scrollable === 'true' && node.rect[3] > node.rect[1]);
  assert.ok(title && list, 'The selected conversation and message viewport are visible');
  // The disposable Pixel 9 emulator is recorded at half its 1080 x 2424 screen resolution.
  const scale = (rect) => rect.map((value) => Math.round(value / 2));
  const content = scale(list.rect);
  content[0] += 12;
  content[1] += 12;
  content[2] -= 12;
  content[3] -= 12;
  return { header: scale(title.rect), content };
}
