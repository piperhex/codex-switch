import { useEffect, useRef, useState } from 'react';
import type { ClipboardContent } from '../../../../../shared/remote-desktop/clipboard';
import type { DesktopClipboard } from '../../../../../shared/remote-desktop/clipboardTransfer';
import { readPastedContent } from '../../../../../shared/chat/clipboard';
import { downloadClipboardFile, filesContent, readBrowserClipboard, writeBrowserClipboard } from './clipboardContent';

interface Options { active: boolean; clipboard: Pick<DesktopClipboard, 'read' | 'write'> }
export function useDesktopClipboard({ active, clipboard }: Options) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [progress, setProgress] = useState<number>();
  const [received, setReceived] = useState<ClipboardContent>();
  const running = useRef(false);
  const generation = useRef(0);
  useEffect(() => {
    if (!active) { setBusy(false); setProgress(undefined); setReceived(undefined); setStatus(''); }
    return () => { generation.current += 1; };
  }, [active]);
  useEffect(() => {
    if (busy || open || !status) return;
    const timeout = setTimeout(() => setStatus(''), 6000);
    return () => clearTimeout(timeout);
  }, [busy, open, status]);
  const run = async (operation: (current: () => boolean) => Promise<void>) => {
    if (!active || running.current) return;
    const started = generation.current;
    const current = () => generation.current === started;
    running.current = true; setBusy(true); setStatus('正在传输剪贴板…'); setProgress(0);
    try { await operation(current); }
    catch (error) {
      if (current()) { setStatus(error instanceof Error ? error.message : '剪贴板传输失败，请重试。'); setOpen(true); }
    } finally {
      running.current = false;
      if (current()) { setBusy(false); setProgress(undefined); }
    }
  };
  const report = (completed: number, total: number) => setProgress(Math.round(completed / total * 100));
  const send = (content: Promise<ClipboardContent>) => {
    // Resolve clipboard event data immediately, even if a previous transfer is still finishing.
    void content.catch(() => undefined);
    void run(async current => {
      const value = await content;
      if (!current()) return;
      await clipboard.write(value, true, report);
      if (current()) setStatus('已粘贴到远程电脑。');
    });
  };
  const copy = (shortcut?: 'copy' | 'cut') => {
    void run(async current => {
      const content = await clipboard.read(shortcut, report);
      if (!current()) return;
      setReceived(content);
      if (content.format === 'files') {
        if (content.files.length === 1) downloadClipboardFile(content.files[0]);
        setStatus('文件已收到，可在下方下载。'); setOpen(true); return;
      }
      try { await writeBrowserClipboard(content); if (current()) setStatus('已复制到本机。'); }
      catch { if (current()) { setStatus('内容已收到，请点击“复制到本机”。'); setOpen(true); } }
    });
  };
  const paste = (data: DataTransfer) => {
    const { files, text, missingImages } = readPastedContent(data);
    if (missingImages) { setStatus('图片未能读取，请保存后选择文件发送。'); setOpen(true); return; }
    if (!files.length && !text) {
      setStatus('剪贴板中没有可发送的内容，请重新复制或选择文件。'); setOpen(true); return;
    }
    send(files.length ? filesContent(files, !data.getData('text/plain')) : Promise.resolve({ format: 'text', text }));
  };
  const save = () => {
    if (!received) return;
    void writeBrowserClipboard(received).then(() => setStatus('已复制到本机。'))
      .catch(() => setStatus('无法写入本机剪贴板，请允许浏览器访问，或手动复制下面的内容。'));
  };
  return { open, setOpen, busy, status, progress, received, copy, paste, save,
    pasteLocal: () => send(readBrowserClipboard()), sendFiles: (files: File[]) => send(filesContent(files)) };
}
