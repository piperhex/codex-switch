import { expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { readClipboardImages } from './clipboardImages';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));

it('preserves every image byte across decode chunks while allowing other events to run', async () => {
  const bytes = Uint8Array.from({ length: 400_001 }, (_, index) => index % 256);
  vi.mocked(invoke).mockResolvedValue([{ mimeType: 'image/png', data: Buffer.from(bytes).toString('base64') }]);
  let responsive = false;
  setTimeout(() => { responsive = true; }, 0);
  const files = await readClipboardImages();
  expect(responsive).toBe(true);
  expect(files).toHaveLength(1);
  expect(files[0].type).toBe('image/png');
  expect(new Uint8Array(await files[0].arrayBuffer())).toEqual(bytes);
  expect(invoke).toHaveBeenCalledWith('codex_gui_remote_clipboard_images');
});
