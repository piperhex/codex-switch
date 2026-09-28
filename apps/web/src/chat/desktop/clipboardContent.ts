import { decodeClipboardBytes, encodeClipboardBytes, MAX_CLIPBOARD_BYTES, MAX_CLIPBOARD_FILES,
  type ClipboardContent } from '../../../../../shared/remote-desktop/clipboard';
import { downloadBlob } from '../fileDownloadTarget';

export async function filesContent(files: File[], image = false): Promise<ClipboardContent> {
  if (!files.length || files.length > MAX_CLIPBOARD_FILES
    || files.reduce((total, file) => total + file.size, 0) > MAX_CLIPBOARD_BYTES) {
    throw new Error('剪贴板内容过大，请分批复制（每次最多 64 MB、32 个文件）。');
  }
  if (image && files.length === 1 && files[0].type.startsWith('image/')) {
    return { format: 'image', data: encodeClipboardBytes(new Uint8Array(await (await pngImage(files[0])).arrayBuffer())) };
  }
  return { format: 'files', files: await Promise.all(files.map(async file => ({
    name: file.name, data: encodeClipboardBytes(new Uint8Array(await file.arrayBuffer())),
  }))) };
}

async function pngImage(file: Blob) {
  const bitmap = await createImageBitmap(file).catch(() => { throw new Error('图片未能读取，请重新复制。'); });
  try {
    if (bitmap.width * bitmap.height > 16_777_216) throw new Error('图片过大，请缩小后再复制。');
    const canvas = document.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('图片未能读取，请重新复制。');
    context.drawImage(bitmap, 0, 0);
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => {
      if (blob) resolve(blob); else reject(new Error('图片未能读取，请重新复制。'));
    }, 'image/png'));
  } finally { bitmap.close(); }
}

export async function readBrowserClipboard(): Promise<ClipboardContent> {
  if (!navigator.clipboard) throw new Error('浏览器未开放剪贴板，请点击桌面后按 Ctrl+V。');
  try {
    if (!navigator.clipboard.read) return { format: 'text', text: await navigator.clipboard.readText() };
    const items = await navigator.clipboard.read();
    const image = items.find(item => item.types.includes('image/png'));
    if (image) return filesContent([new File([await image.getType('image/png')], 'clipboard.png',
      { type: 'image/png' })], true);
    const text = items.find(item => item.types.includes('text/plain'));
    if (text) return { format: 'text', text: await (await text.getType('text/plain')).text() };
  } catch { throw new Error('无法读取本机剪贴板，请点击桌面后按 Ctrl+V，或选择文件发送。'); }
  throw new Error('剪贴板中没有可发送的内容，请重新复制或选择文件。');
}

export async function writeBrowserClipboard(content: ClipboardContent) {
  if (!navigator.clipboard) throw new Error('浏览器未开放剪贴板，请手动复制下面的内容。');
  if (content.format === 'text') return navigator.clipboard.writeText(content.text);
  if (content.format === 'image') {
    const bytes = decodeClipboardBytes(content.data);
    return navigator.clipboard.write([new ClipboardItem({ 'image/png': new Blob([bytes], { type: 'image/png' }) })]);
  }
}
export function downloadClipboardFile(file: { name: string; data: string }) {
  const name = file.name.split(/[\\/]/).at(-1)?.replace(/[\u0000-\u001f]/g, '') || 'clipboard-file';
  downloadBlob(new Blob([decodeClipboardBytes(file.data)], { type: 'application/octet-stream' }), name);
}
