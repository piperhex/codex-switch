import { useEffect, useRef, useState, type ClipboardEvent, type KeyboardEvent } from 'react';
import { t } from '../i18n';

interface Options {
  scope: string | null;
  active: boolean;
  busy: boolean;
  readClipboardImages?: () => Promise<File[]>;
  addFiles: (files: File[]) => Promise<void>;
}
interface PendingPaste { files: File[]; text: boolean }

function clipboardFiles(data: DataTransfer) {
  const files = Array.from(data.files ?? []);
  if (files.length) return files;
  return Array.from(data.items ?? []).filter(item => item.kind === 'file')
    .map(item => item.getAsFile()).filter((file): file is File => file !== null);
}

/** Coalesce native shortcuts and DOM paste events; never send local paths to another computer. */
export function useComposerPaste(options: Options) {
  const [reading, setReading] = useState(false);
  const [error, setError] = useState('');
  const pending = useRef<PendingPaste | null>(null);
  const generation = useRef(0);
  const latest = useRef(options);
  latest.current = options;
  useEffect(() => {
    generation.current++;
    pending.current = null; setReading(false); setError('');
    return () => { generation.current++; pending.current = null; };
  }, [options.scope, options.active]);

  const read = (files: File[] = []) => {
    if (pending.current) { pending.current.files = files; return; }
    if (!options.active || options.busy) return;
    const request: PendingPaste = { files, text: false };
    const current = generation.current;
    const valid = () => current === generation.current && latest.current.active
      && latest.current.scope === options.scope;
    pending.current = request; setReading(true); setError('');
    void (async () => {
      let native: File[] = [];
      try { native = await options.readClipboardImages?.() ?? []; }
      catch {
        if (valid() && !request.files.length && !request.text) {
          setError(t('图片粘贴失败，请重新复制后再试。'));
        }
      }
      if (!valid() || request.text) return;
      const selected = native.length ? native : request.files;
      if (selected.length) await latest.current.addFiles(selected);
    })().catch(() => {
      if (valid()) setError(t('图片粘贴失败，请重新复制后再试。'));
    }).finally(() => {
      if (pending.current === request) { pending.current = null; setReading(false); }
    });
  };
  const paste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const files = clipboardFiles(event.clipboardData);
    if (!files.length && event.clipboardData.getData('text/plain')) {
      if (pending.current) pending.current.text = true;
      return;
    }
    if (!files.length && !options.readClipboardImages) return;
    event.preventDefault(); read(files);
  };
  const pasteKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    const shortcut = ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'v')
      || (event.shiftKey && event.key === 'Insert');
    if (options.readClipboardImages && shortcut && !event.altKey && !event.repeat) read();
  };
  return { paste, pasteKeyDown, reading, error };
}
