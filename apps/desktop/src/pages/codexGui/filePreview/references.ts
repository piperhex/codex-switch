import { parseFileReference, type FileReference } from "../fileReference";

/** Resolve relative links against the previewed document, not the conversation directory. */
export function previewReference(href: string, path: string): FileReference | undefined {
  if (href.startsWith("#")) return undefined;
  const reference = parseFileReference(href);
  if (!reference) return undefined;
  if (/^(?:[a-z]:[\\/]|\/)/i.test(reference.path)) return reference;
  const folder = path.replace(/\\/g, "/").replace(/[^/]*$/, "");
  return { ...reference, path: folder + reference.path };
}

export function previewImageUrl(source: string | undefined, url: string, path = ""): string | undefined {
  if (!source) return undefined;
  if (/^(?:https?:\/\/|data:image\/)/i.test(source)) return source;
  if (/^(?:[a-z][\w+.-]*:|\/|\\)/i.test(source)) {
    const reference = previewReference(source, path)?.path.replace(/\\/g, "/");
    const folder = path.replace(/\\/g, "/").replace(/[^/]*$/, "");
    if (!folder || !reference) return undefined;
    const windowsPath = /^[a-z]:/i.test(folder);
    const contained = windowsPath ? reference.toLowerCase().startsWith(folder.toLowerCase())
      : reference.startsWith(folder);
    if (!contained) return undefined;
    return new URL(reference.slice(folder.length).split("/").map(encodeURIComponent).join("/"), url).href;
  }
  return new URL(source, url).href;
}
