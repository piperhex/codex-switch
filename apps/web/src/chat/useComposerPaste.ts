import { useEffect, useRef, useState, type ClipboardEvent, type KeyboardEvent } from 'react';
import { t } from '../i18n';
import { MISSING_CLIPBOARD_IMAGES, readPastedContent } from '../../../../shared/chat/clipboard';

interface Options {
  scope: string | null;
  active: boolean;
  busy: boolean;
  readClipboardImages?: () => Promise<File[]>;
  addFiles: (files: File[]) => Promise<void>;
  insertText?: (text: string, input: HTMLTextAreaElement) => void;
}
interface PendingPaste { files: File[]; textOnly: boolean; missingImages: boolean }

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

  const read = (files: File[] = [], missingImages = false) => {
    if (pending.current) {
      pending.current.files = files; pending.current.missingImages = missingImages; return;
    }
    if (!options.active || options.busy) return;
    const request: PendingPaste = { files, textOnly: false, missingImages };
    const current = generation.current;
    const valid = () => current === generation.current && latest.current.active
      && latest.current.scope === options.scope;
    pending.current = request; setReading(true); setError('');
    void (async () => {
      let native: File[] = [];
      try { native = await options.readClipboardImages?.() ?? []; }
      catch {
        if (valid() && !request.files.length && !request.textOnly) {
          setError(t('图片粘贴失败，请重新复制后再试。'));
        }
      }
      if (!valid() || request.textOnly) return;
      const selected = native.length ? native : request.files;
      if (selected.length) await latest.current.addFiles(selected);
      if (valid() && !native.length && request.missingImages) setError(t(MISSING_CLIPBOARD_IMAGES));
    })().catch(() => {
      if (valid()) setError(t('图片粘贴失败，请重新复制后再试。'));
    }).finally(() => {
      if (pending.current === request) { pending.current = null; setReading(false); }
    });
  };
  const paste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const { files, text, hasImages, missingImages } = readPastedContent(event.clipboardData);
    if (!files.length && text && !hasImages) {
      if (pending.current) pending.current.textOnly = true;
      return;
    }
    if (!files.length && !hasImages && !options.readClipboardImages) return;
    event.preventDefault();
    if (!options.active || options.busy) return;
    if (text) options.insertText?.(text, event.currentTarget);
    read(files, missingImages);
  };
  const pasteKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    const shortcut = ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'v')
      || (event.shiftKey && event.key === 'Insert');
    if (options.readClipboardImages && shortcut && !event.altKey && !event.repeat) read();
  };
  return { paste, pasteKeyDown, reading, error };
}
