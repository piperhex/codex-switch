import { useEffect, useRef, useState } from 'react';
import * as DocumentPicker from 'expo-document-picker';
import { readAsStringAsync, EncodingType } from 'expo-file-system';
import type { AttachmentReference, ComposerPlugin } from '../../../desktop/src/pages/codexGui/attachmentTypes';
import { MAX_CHAT_FILE_BYTES, remoteAttachments } from '../../../../shared/remote-chat/composerAttachments';

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
    generation.current += 1;
    setItems([]); setError('');
  }, [threadId, sending]);
  const pick = async () => {
    if (picking.current || sending) return;
    const current = generation.current;
    picking.current = true; setBusy(true); setError('');
    try {
      const result = await DocumentPicker.getDocumentAsync({ multiple: true, copyToCacheDirectory: true });
      if (result.canceled || current !== generation.current) return;
      const additions: AttachmentReference[] = [];
      for (const asset of result.assets) {
        if (current !== generation.current) return;
        if (asset.size !== undefined && asset.size > MAX_CHAT_FILE_BYTES) {
          throw new Error('单个文件不能超过 2 MB，请选择较小的文件。');
        }
        const data = await readAsStringAsync(asset.uri, { encoding: EncodingType.Base64 });
        additions.push({ kind: 'file', name: asset.name, path: '', data });
        remoteAttachments([...items, ...additions]);
      }
      if (current === generation.current) setItems((existing) => [...existing, ...additions]);
    } catch (cause) {
      if (current === generation.current) setError(cause instanceof Error
        && /文件|附件/.test(cause.message) ? cause.message : '文件添加失败，请重新选择。');
    } finally { picking.current = false; if (mounted.current) setBusy(false); }
  };
  const addPlugin = (plugin: ComposerPlugin) => {
    const item: AttachmentReference = { kind: 'plugin', name: plugin.interface?.displayName || plugin.name,
      path: `plugin://${plugin.id}` };
    try { setItems(remoteAttachments([...items.filter((entry) => entry.path !== item.path), item])); setError(''); }
    catch { setError('每条消息最多添加 8 个文件或插件。'); }
  };
  const addFile = (item: AttachmentReference) => {
    try { setItems(remoteAttachments([...items.filter((entry) => entry.path !== item.path), item])); setError(''); }
    catch { setError('每条消息最多添加 8 个文件或插件。'); }
  };
  return { items, busy, error, pick, addPlugin, addFile,
    remove: (item: AttachmentReference) => setItems((current) => current.filter((entry) => entry !== item)),
    clearSubmitted: (submitted: AttachmentReference[]) =>
      setItems((current) => current.filter((entry) => !submitted.includes(entry))) };
}
