export const CLIPBOARD_CHUNK_BYTES = 32 * 1024;
export const MAX_CLIPBOARD_BYTES = 64 * 1024 * 1024;
export const MAX_CLIPBOARD_WIRE_BYTES = MAX_CLIPBOARD_BYTES * 2;
export const MAX_CLIPBOARD_FILES = 32;
export const MAX_CONTROL_MESSAGE_BYTES = 64 * 1024;
export type ClipboardContent = { format: 'text'; text: string } | { format: 'image'; data: string }
  | { format: 'files'; files: { name: string; data: string }[] };
/** Platform clipboard access, invoked only in response to a copy or paste gesture. */
export interface LocalDesktopClipboard {
  files: boolean;
  read: () => Promise<ClipboardContent>;
  write: (content: ClipboardContent) => Promise<void>;
}
export type ClipboardRequest = { action: 'read'; shortcut?: 'copy' | 'cut' }
  | { action: 'begin'; length: number } | { action: 'append'; offset: number; data: string }
  | { action: 'commit'; paste: boolean } | { action: 'chunk'; offset: number } | { action: 'clear' };
export interface ClipboardMessage {
  kind: 'clipboard'; requestId: number; transferId: string; request: ClipboardRequest;
}
export interface ClipboardReply {
  kind: 'clipboard'; requestId: number; result?: { length?: number; data?: string }; error?: string;
}
export type ClipboardProgress = (completed: number, total: number) => void;

export function encodeClipboardBytes(bytes: Uint8Array) {
  let encoded = '';
  for (let offset = 0; offset < bytes.length; offset += CLIPBOARD_CHUNK_BYTES) {
    encoded += String.fromCharCode(...bytes.subarray(offset, offset + CLIPBOARD_CHUNK_BYTES));
  }
  return btoa(encoded);
}
export function decodeClipboardBytes(data: string) {
  return Uint8Array.from(atob(data), character => character.charCodeAt(0));
}
export function validateClipboardContent(value: unknown): ClipboardContent {
  if (!value || typeof value !== 'object') throw new Error('剪贴板内容无效，请重新复制。');
  const content = value as Partial<ClipboardContent>;
  if (content.format === 'text' && typeof content.text === 'string') return content as ClipboardContent;
  if (content.format === 'image' && typeof content.data === 'string') return content as ClipboardContent;
  if (content.format === 'files' && Array.isArray(content.files) && content.files.length > 0
    && content.files.length <= MAX_CLIPBOARD_FILES && content.files.every(file => file
      && typeof file.name === 'string' && typeof file.data === 'string')) return content as ClipboardContent;
  throw new Error('剪贴板内容无效，请重新复制。');
}
