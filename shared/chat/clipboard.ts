const MAX_HTML_LENGTH = 2 * 1024 * 1024;
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const MAX_IMAGES = 8;
const IMAGE_DATA = /^data:(image\/(?:png|jpeg|webp|gif|bmp));base64,([\s\S]*)$/i;

export interface PastedContent {
  files: File[];
  text: string;
  hasImages: boolean;
  missingImages: boolean;
}

function embeddedImage(source: string, index: number): File | null {
  const match = IMAGE_DATA.exec(source);
  if (!match || match[2].length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4) return null;
  try {
    const bytes = Uint8Array.from(atob(match[2]), character => character.charCodeAt(0));
    return new File([bytes], `clipboard-${index + 1}`, { type: match[1].toLowerCase() });
  } catch { return null; }
}

function htmlContent(html: string) {
  // A detached template is inert: pasted markup must never run scripts or load URLs.
  const template = document.createElement('template');
  template.innerHTML = html;
  const content = template.content;
  content.querySelectorAll('script,style,iframe,object,template').forEach(node => node.remove());
  const sources = Array.from(content.querySelectorAll('img')).map(image => image.getAttribute('src') ?? '');
  content.querySelectorAll('br').forEach(node => node.replaceWith('\n'));
  content.querySelectorAll('p,div,li').forEach(node => node.append('\n'));
  return { sources, text: (content.textContent ?? '').replace(/\n+$/, '') };
}

/** Snapshot the paste payload synchronously; browsers clear DataTransfer after the event. */
export function readPastedContent(data: DataTransfer): PastedContent {
  const files = Array.from(data.files ?? []);
  if (!files.length) files.push(...Array.from(data.items ?? []).filter(item => item.kind === 'file')
    .map(item => item.getAsFile()).filter((file): file is File => file !== null));
  const html = data.getData?.('text/html') ?? '';
  const rich = html && html.length <= MAX_HTML_LENGTH ? htmlContent(html) : { sources: [], text: '' };
  const plain = (data.getData?.('text/plain') ?? '').replace(/\r\n?/g, '\n');
  const hasImages = rich.sources.length > 0;
  const browserImages = files.filter(file => file.type.startsWith('image/')).length;
  // Chromium may already expose HTML image references as Files. Do not add the same image twice.
  if (!browserImages) {
    files.push(...rich.sources.slice(0, MAX_IMAGES).map(embeddedImage).filter((file): file is File => file !== null));
  }
  const imageCount = files.filter(file => file.type.startsWith('image/')).length;
  const imagesOnly = files.length > 0 && imageCount === files.length;
  const fileNames = plain.trim().split(/\r?\n/).every(line => files.some(file =>
    line === file.name || line.replace(/\\/g, '/').split('/').at(-1) === file.name));
  const text = hasImages || !files.length || (imagesOnly && !fileNames) ? plain || rich.text : '';
  return { files, text, hasImages, missingImages: rich.sources.length > imageCount };
}

export const MISSING_CLIPBOARD_IMAGES = '部分图片未能粘贴，请单独复制图片，或保存后添加。';
