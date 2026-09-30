import type { AttachmentReference } from '../../apps/desktop/src/pages/codexGui/attachmentTypes';
import type { ConnectionMode } from './protocol';
import { base64Bytes, checkFileUploadSize, fileUploadTotalByteLimit, getChatPolicy, MIB } from './policy';

export const MAX_CHAT_FILES = 8;
const DEFAULT_ATTACHMENT_DATA = 6 * MIB;
const IMAGE_RESERVE_CHARS = 2 * MIB;
const MAX_NAME_LENGTH = 200;
const MAX_PLUGIN_PATH_LENGTH = 310;
const MAX_CONVERSATION_PATH_LENGTH = 213;

// Keep the existing image allowance and grow the mixed payload allowance with file uploads.
export function chatAttachmentDataLimit(mode?: ConnectionMode) {
  return Math.min(Number.MAX_SAFE_INTEGER, Math.max(DEFAULT_ATTACHMENT_DATA,
    Math.ceil(fileUploadTotalByteLimit(mode) / 3) * 4 + IMAGE_RESERVE_CHARS));
}

/** Recheck at submission so queued uploads follow the latest administrator settings. */
export function validateUploadedFiles(attachments: readonly AttachmentReference[], mode?: ConnectionMode) {
  let total = 0;
  for (const item of attachments) {
    if (item.data === undefined) continue;
    const bytes = base64Bytes(item.data);
    checkFileUploadSize(bytes, mode);
    total += bytes;
    if (total > fileUploadTotalByteLimit(mode)) {
      throw new Error(`每次发送的文件合计不能超过 ${getChatPolicy().fileUploadTotalMaxMb} MB，请减少文件。`);
    }
  }
}

export function remoteAttachments(value: unknown, mode?: ConnectionMode): AttachmentReference[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_CHAT_FILES) throw new Error('每条消息最多添加 8 个附件或对话引用。');
  const attachments = value.map((entry: unknown): AttachmentReference => {
    const item = entry && typeof entry === 'object' ? entry as Record<string, unknown> : {};
    if (typeof item.name !== 'string' || !item.name.trim() || item.name.length > MAX_NAME_LENGTH
      || /[\x00-\x1f\x7f]/u.test(item.name)) throw new Error('附件名称无效，请重新选择。');
    if (item.kind === 'plugin' && typeof item.path === 'string' && item.path.length <= MAX_PLUGIN_PATH_LENGTH
      && /^plugin:\/\/[\w.@-]+$/.test(item.path) && item.data === undefined) {
      return { kind: 'plugin', name: item.name, path: item.path };
    }
    if (item.kind === 'conversation' && typeof item.path === 'string'
      && item.path.length <= MAX_CONVERSATION_PATH_LENGTH
      && /^codex-thread:\/\/[^/\\\x00-\x1f\x7f]+$/u.test(item.path) && item.data === undefined) {
      return { kind: 'conversation', name: item.name, path: item.path };
    }
    if (item.kind === 'file' && item.data === undefined && typeof item.path === 'string'
      && item.path.length <= 4096 && /^(?:[A-Za-z]:[\\/]|\/(?!\/))/.test(item.path)
      && !/[\x00-\x1f\x7f]/u.test(item.path)) return { kind: 'file', name: item.name, path: item.path };
    if (item.kind !== 'file' || item.path !== '' || typeof item.data !== 'string' || !item.data
      || item.data.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(item.data)) {
      throw new Error('文件无法读取，请重新选择。');
    }
    return { kind: 'file', name: item.name, path: '', data: item.data };
  });
  validateUploadedFiles(attachments, mode);
  return attachments;
}
