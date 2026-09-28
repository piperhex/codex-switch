import { useEffect, useRef, useState } from 'react';
import type { ClipboardContent, LocalDesktopClipboard } from '../../../../../shared/remote-desktop/clipboard';
import type { DesktopClipboard } from '../../../../../shared/remote-desktop/clipboardTransfer';
import { readPastedContent } from '../../../../../shared/chat/clipboard';
import { browserDesktopClipboard, downloadClipboardFile, filesContent } from './clipboardContent';

interface Options {
  active: boolean; clipboard: Pick<DesktopClipboard, 'read' | 'write'>; localClipboard?: LocalDesktopClipboard;
}
export function useDesktopClipboard({ active, clipboard, localClipboard }: Options) {
  const local = localClipboard ?? browserDesktopClipboard;
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [progress, setProgress] = useState<number>();
  const [received, setReceived] = useState<ClipboardContent>();
  const queue = useRef({ tail: Promise.resolve(), pending: 0 });
  const pendingCopy = useRef<Promise<ClipboardContent | undefined>>();
  const generation = useRef(0);
  useEffect(() => {
    if (!active) { setBusy(false); setProgress(undefined); setReceived(undefined); setStatus(''); }
    return () => {
      generation.current += 1; queue.current = { tail: Promise.resolve(), pending: 0 }; pendingCopy.current = undefined;
    };
  }, [active]);
  useEffect(() => {
    if (busy || open || !status) return;
    const timeout = setTimeout(() => setStatus(''), 6000);
    return () => clearTimeout(timeout);
  }, [busy, open, status]);
  const run = <Result,>(operation: (current: () => boolean) => Promise<Result>): Promise<Result | undefined> => {
    if (!active) return Promise.resolve(undefined);
    const started = generation.current;
    const current = () => generation.current === started;
    const pending = queue.current;
    pending.pending += 1; setBusy(true);
    const task = pending.tail.then(async () => {
      if (!current()) return;
      setStatus('正在传输剪贴板…'); setProgress(0);
      try { return await operation(current); }
      catch (error) {
        if (current()) {
          setStatus(error instanceof Error ? error.message
            : typeof error === 'string' ? error : '剪贴板传输失败，请重试。');
          setOpen(true);
        }
      } finally {
        pending.pending -= 1;
        if (current()) { setBusy(pending.pending > 0); setProgress(undefined); }
      }
    });
    pending.tail = task.then(() => undefined);
    return task;
  };
  const report = (current: () => boolean) => (completed: number, total: number) => {
    if (current()) setProgress(Math.round(completed / total * 100));
  };
  const send = (content: () => Promise<ClipboardContent>) => {
    void run(async current => {
      const value = await content();
      if (!current()) return;
      await clipboard.write(value, true, report(current));
      if (current()) setStatus('已粘贴到远程电脑。');
    });
  };
  const copy = (shortcut?: 'copy' | 'cut') => {
    const task = run(async current => {
      const content = await clipboard.read(shortcut, report(current));
      if (!current()) return;
      setReceived(content);
      if (content.format === 'files' && !local.files) {
        if (content.files.length === 1) downloadClipboardFile(content.files[0]);
        setStatus('文件已收到，可在下方下载。'); setOpen(true); return content;
      }
      try { await local.write(content); if (current()) setStatus('已复制到本机，可直接粘贴。'); }
      catch { if (current()) { setStatus('内容已收到，请点击“复制到本机”。'); setOpen(true); } }
      return content;
    });
    pendingCopy.current = task;
    void task.then(() => { if (pendingCopy.current === task) pendingCopy.current = undefined; });
  };
  const paste = (data: DataTransfer) => {
    if (localClipboard) { send(local.read); return; }
    // A trusted paste event may still contain the old local clipboard while the remote copy is in flight.
    const copying = pendingCopy.current;
    if (copying) {
      send(async () => {
        const content = await copying;
        if (!content) throw new Error('未能复制所选内容，请确认远程窗口后重试。');
        return content;
      });
      return;
    }
    const { files, text, missingImages } = readPastedContent(data);
    if (missingImages) { setStatus('图片未能读取，请保存后选择文件发送。'); setOpen(true); return; }
    if (!files.length && !text) {
      setStatus('剪贴板中没有可发送的内容，请重新复制或选择文件。'); setOpen(true); return;
    }
    const image = !data.getData('text/plain');
    send(() => files.length ? filesContent(files, image) : Promise.resolve({ format: 'text', text }));
  };
  const save = () => {
    if (!received) return;
    void run(async current => {
      try { await local.write(received); }
      catch { throw new Error('无法访问剪贴板，请重新复制后再试。'); }
      if (current()) setStatus('已复制到本机，可直接粘贴。');
    });
  };
  const pasteLocal = () => send(local.read);
  return { open, setOpen, busy, status, progress, received, copy, paste, save, nativeFiles: local.files,
    pasteShortcut: localClipboard ? pasteLocal : undefined,
    pasteLocal, sendFiles: (files: File[]) => send(() => filesContent(files)) };
}
