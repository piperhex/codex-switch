import { invoke } from '@tauri-apps/api/core';

interface ClipboardImage { mimeType: string; data: string }
const BASE64_CHUNK_LENGTH = 256 * 1024; // Multiple of four so each block decodes independently.

async function imageFile(image: ClipboardImage, index: number) {
  const parts: Uint8Array[] = [];
  for (let offset = 0; offset < image.data.length; offset += BASE64_CHUNK_LENGTH) {
    const decoded = atob(image.data.slice(offset, offset + BASE64_CHUNK_LENGTH));
    parts.push(Uint8Array.from(decoded, character => character.charCodeAt(0)));
    // Large native copies should not prevent typing or switching to another conversation.
    if (offset + BASE64_CHUNK_LENGTH < image.data.length) await new Promise(resolve => setTimeout(resolve, 0));
  }
  return new File(parts, `clipboard-${index + 1}`, { type: image.mimeType });
}

export async function readClipboardImages(): Promise<File[]> {
  const images = await invoke<ClipboardImage[]>('codex_gui_remote_clipboard_images');
  const files: File[] = [];
  for (const [index, image] of images.entries()) files.push(await imageFile(image, index));
  return files;
}
