export interface FileReference { path: string; line?: number; column?: number }

/** Markdown file links may carry editor line numbers, which are not part of the filename. */
export function parseFileReference(href: string): FileReference | undefined {
  let path = href;
  if (!/^file:/i.test(path)) {
    // Plain filesystem names may contain a literal percent sign, unlike encoded file URLs.
    try { path = decodeURIComponent(path); } catch { /* Keep the original filename. */ }
  }
  if (/^(?:\/\/|\\\\|\/__codex_switch__\/)/.test(path) || /[\0\r\n]/.test(path)) return undefined;
  const location = path.match(/(?::(\d+)(?::(\d+))?|#L(\d+)(?:C(\d+))?(?:-L?\d+)?)$/i);
  if (location) path = path.slice(0, location.index);
  if (/^file:/i.test(path)) {
    try {
      const url = new URL(path);
      if (url.host && url.host !== "localhost" || url.search || url.hash) return undefined;
      path = decodeURIComponent(url.pathname);
    } catch { return undefined; }
  }
  path = path.replace(/^\/([a-z]:\/)/i, "$1");
  if (/^(?:\/\/|\\\\|\/__codex_switch__\/)/.test(path) || /[\0\r\n]/.test(path)) return undefined;
  if (/^[a-z][a-z\d+.-]*:/i.test(path) && !/^[a-z]:[\\/]/i.test(path)) return undefined;
  if (!/^(?:[a-z]:[\\/]|\/[^/]|\.\.?[\\/])/i.test(path)
    && !/^(?:[^\\/:?#]+[\\/])+[^:?#]+$|^[^\\/:?#]+\.[\w-]+$/.test(path)) return undefined;
  const line = Number(location?.[1] ?? location?.[3]) || undefined;
  const column = Number(location?.[2] ?? location?.[4]) || undefined;
  return { path, ...(line && { line }), ...(column && { column }) };
}

export function isFileReference(href: string) { return Boolean(parseFileReference(href)); }
