import type { Item } from "../remote-chat/client/types";

export function isInlineImage(src: string) {
  return /^data:image\/(png|jpeg|webp|gif);base64,[a-z0-9+/=]+$/i.test(src);
}

/** Local references go through scoped IPC; they must never become WebView endpoint URLs. */
export function localImageSource(source: string): string | undefined {
  if (/^file:\/\//i.test(source)) {
    try {
      const url = new URL(source);
      return (!url.hostname || url.hostname === "localhost") && !url.search && !url.hash
        && /\.(png|jpe?g|webp|gif)$/i.test(url.pathname) ? source : undefined;
    } catch { return undefined; }
  }
  let path: string;
  try { path = decodeURIComponent(source); } catch { return undefined; }
  if (!/\.(png|jpe?g|webp|gif)$/i.test(path) || /[\0?#]/.test(path)
    || /^[\\/]{2}/.test(path) || path.startsWith("/__codex_switch__/")) return undefined;
  if (path.includes(":") && !/^[a-z]:[\\/][^:]*$/i.test(path)) return undefined;
  return path;
}

export function generatedImageSource(item: Item): string | undefined {
  if (item.imageUrl) return item.imageUrl;
  if (typeof item.result === "string" && item.result) {
    if (/^(https?:|data:)/i.test(item.result) || localImageSource(item.result)) return item.result;
    if (/^[a-z0-9+/=]+$/i.test(item.result)) return `data:image/png;base64,${item.result}`;
  }
  return item.savedPath || item.path;
}

export function itemImageSources(item: Item): string[] {
  if (item.type === 'imageGeneration' || item.type === 'imageView') {
    const source = generatedImageSource(item);
    return source ? [source] : [];
  }
  if (item.type !== 'userMessage') return [];
  return (item.content ?? []).flatMap((entry) => {
    if (typeof entry === 'string') return [];
    const source = entry.type === 'localImage' ? entry.path : entry.type === 'image' ? entry.url : undefined;
    return source ? [source] : [];
  });
}
