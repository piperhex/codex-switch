import thumbnail from '../src-tauri/icons/32x32.png?inline';
import { contentHash } from '../../../shared/remote-chat/historySync';

let original: string;
export function demoOriginal() {
  if (original) return original;
  const canvas = document.createElement('canvas');
  canvas.width = 900;
  canvas.height = 700;
  const context = canvas.getContext('2d')!;
  const pixels = context.createImageData(canvas.width, canvas.height);
  let seed = 7;
  for (let index = 0; index < pixels.data.length; index += 4) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    pixels.data[index] = seed & 255;
    pixels.data[index + 1] = (seed >>> 8) & 255;
    pixels.data[index + 2] = (seed >>> 16) & 255;
    pixels.data[index + 3] = 255;
  }
  context.putImageData(pixels, 0, 0);
  original = canvas.toDataURL('image/png');
  return original;
}

export function demoImageResponse(input: Record<string, unknown>) {
  if (input.operation === 'imagePreview') return { url: thumbnail };
  const url = demoOriginal();
  const offset = Number(input.offset ?? 0);
  return { data: url.slice(offset, offset + 256 * 1024), total: url.length, hash: contentHash(url) };
}
