import { useRef, useState, type ClipboardEvent, type KeyboardEvent } from "react";
import { invoke, isDesktopApp } from "../../api/backend";
import type { AttachmentReference } from "./attachmentTypes";

interface PasteOptions {
  key: string;
  addAttachments: (items: AttachmentReference[]) => void;
  addImages: (files: File[]) => void;
  report: (message: string) => void;
}
interface PendingPaste { fallback?: () => void }

/** Native file copies may not produce a WebView paste event; also listen for the paste shortcut. */
export function useFilePaste({ key, addAttachments, addImages, report }: PasteOptions) {
  const pending = useRef(new Map<string, PendingPaste>());
  const [reading, setReading] = useState<Record<string, boolean>>({});
  const readNative = () => {
    const existing = pending.current.get(key);
    if (existing) return existing;
    const request: PendingPaste = {};
    pending.current.set(key, request);
    setReading((values) => ({ ...values, [key]: true }));
    void invoke<AttachmentReference[]>("codex_gui_clipboard_files").then((files) => {
      if (files.length) addAttachments(files);
      else request.fallback?.();
    }).catch(() => {
      if (request.fallback) request.fallback();
      else report("文件粘贴失败，请重新复制后再试。");
    }).finally(() => {
      pending.current.delete(key);
      setReading((values) => ({ ...values, [key]: false }));
    });
    return request;
  };
  const pasteKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    const shortcut = ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "v")
      || (event.shiftKey && event.key === "Insert");
    if (isDesktopApp && shortcut && !event.altKey && !event.repeat) readNative();
  };
  const paste = (event: ClipboardEvent<HTMLElement>) => {
    const files = Array.from(event.clipboardData.items)
      .filter((item) => item.kind === "file").map((item) => item.getAsFile())
      .filter((file): file is File => file !== null);
    if (!files.length && event.clipboardData.getData?.("text/plain")) {
      const request = pending.current.get(key);
      // Plain text needs no native fallback, even if the clipboard is temporarily busy.
      if (request) request.fallback = () => {};
      return;
    }
    const fallback = () => {
      if (!files.length) return;
      const images = files.filter((file) => file.type.startsWith("image/"));
      if (images.length) addImages(images);
      if (images.length !== files.length) report("请通过“添加文件”选择这些文件。");
    };
    if (isDesktopApp) {
      event.preventDefault();
      const request = readNative();
      if (files.length) request.fallback = fallback;
    } else if (files.length) {
      event.preventDefault();
      fallback();
    }
  };
  return { paste, pasteKeyDown, readingFiles: Boolean(reading[key]) };
}
