import { parseFileReference as parseSharedReference } from "../../../../../shared/chat/fileReference";
export type { FileReference } from "../../../../../shared/chat/fileReference";

export function parseFileReference(href: string) {
  const reference = parseSharedReference(href);
  if (reference) return reference;
  // Extensionless filenames such as LICENSE, Dockerfile and scripts are valid Markdown resources.
  if (!/^[^\\/:?#\u0000-\u001f]+(?:#L\d+(?:C\d+)?)?$/.test(href)) return undefined;
  const relative = parseSharedReference(`./${href}`);
  return relative ? { ...relative, path: relative.path.slice(2) } : undefined;
}
export function isFileReference(href: string) { return Boolean(parseFileReference(href)); }
