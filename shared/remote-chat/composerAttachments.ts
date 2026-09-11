import type { AttachmentReference } from '../../apps/desktop/src/pages/codexGui/attachmentTypes';

export const MAX_CHAT_FILES = 8;
export const MAX_CHAT_FILE_BYTES = 2 * 1024 * 1024;
export const MAX_CHAT_FILE_DATA = 4 * 1024 * 1024;
export const MAX_CHAT_ATTACHMENT_DATA = 6 * 1024 * 1024;
const MAX_NAME_LENGTH = 200;
const MAX_PLUGIN_PATH_LENGTH = 310;

export function remoteAttachments(value: unknown): AttachmentReference[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_CHAT_FILES) throw new Error('每条消息最多添加 8 个文件或插件。');
  let total = 0;
  return value.map((entry: unknown) => {
    const item = entry && typeof entry === 'object' ? entry as Record<string, unknown> : {};
    if (typeof item.name !== 'string' || !item.name.trim() || item.name.length > MAX_NAME_LENGTH
      || /[\x00-\x1f\x7f]/u.test(item.name)) throw new Error('附件名称无效，请重新选择。');
    if (item.kind === 'plugin' && typeof item.path === 'string' && item.path.length <= MAX_PLUGIN_PATH_LENGTH
      && /^plugin:\/\/[\w.@-]+$/.test(item.path) && item.data === undefined) {
      return { kind: 'plugin', name: item.name, path: item.path };
    }
    if (item.kind === 'file' && item.data === undefined && typeof item.path === 'string'
      && item.path.length <= 4096 && /^(?:[A-Za-z]:[\\/]|\/(?!\/))/.test(item.path)
      && !/[\x00-\x1f\x7f]/u.test(item.path)) return { kind: 'file', name: item.name, path: item.path };
    if (item.kind !== 'file' || item.path !== '' || typeof item.data !== 'string' || !item.data
      || item.data.length > Math.ceil(MAX_CHAT_FILE_BYTES / 3) * 4
      || item.data.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(item.data)) {
      throw new Error('文件无法添加，请选择不超过 2 MB 的文件。');
    }
    total += item.data.length;
    if (total > MAX_CHAT_FILE_DATA) throw new Error('文件总大小过大，请减少文件后再试。');
    return { kind: 'file', name: item.name, path: '', data: item.data };
  });
}
