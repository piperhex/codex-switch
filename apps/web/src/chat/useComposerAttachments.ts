import { t } from '../i18n';
import { useEffect, useRef, useState } from 'react';
import type { AttachmentReference, ComposerPlugin } from '../../../desktop/src/pages/codexGui/attachmentTypes';
import { remoteAttachments } from '../../../../shared/remote-chat/composerAttachments';
import { checkFileUploadSize } from '../../../../shared/remote-chat/policy';

function readFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(t("文件无法读取，请重新选择。")));
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
    reader.readAsDataURL(file);
  });
}

export function useComposerAttachments({ threadId, sending }: { threadId: string | null; sending: boolean }) {
  const [items, setItems] = useState<AttachmentReference[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const picking = useRef(false);
  const mounted = useRef(true);
  const generation = useRef(0);
  const scope = useRef(threadId);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; generation.current += 1; }; }, []);
  useEffect(() => {
    if (scope.current === threadId) return;
    const creating = scope.current === null && sending;
    scope.current = threadId;
    if (creating) return;
    generation.current += 1; setItems([]); setError('');
  }, [threadId, sending]);
  const pick = async (files: File[]) => {
    if (picking.current || sending || !files.length) return;
    const current = generation.current;
    picking.current = true; setBusy(true); setError('');
    try {
      const additions: AttachmentReference[] = [];
      for (const file of files) {
        if (current !== generation.current) return;
        checkFileUploadSize(file.size);
        additions.push({ kind: 'file', name: file.name, path: '', data: await readFile(file) });
        remoteAttachments([...items, ...additions]);
      }
      if (current === generation.current) setItems(existing => [...existing, ...additions]);
    } catch (cause) {
      if (current === generation.current) setError(cause instanceof Error && /文件|附件/.test(cause.message)
        ? cause.message : t("文件添加失败，请重新选择。"));
    } finally { picking.current = false; if (mounted.current) setBusy(false); }
  };
  const add = (item: AttachmentReference) => {
    if (sending || picking.current) return false;
    try {
      setItems(remoteAttachments([...items.filter(entry => entry.path !== item.path), item])); setError('');
      return true;
    } catch { setError(t('每条消息最多添加 8 个附件或对话引用。')); return false; }
  };
  return { items, busy, error, pick, add,
    addPlugin: (plugin: ComposerPlugin) => add({ kind: 'plugin', name: plugin.interface?.displayName || plugin.name,
      path: `plugin://${plugin.id}` }),
    restore: setItems, remove: (item: AttachmentReference) => setItems(current => current.filter(entry => entry !== item)),
    clearSubmitted: (submitted: AttachmentReference[]) =>
      setItems(current => current.filter(entry => !submitted.includes(entry))) };
}
