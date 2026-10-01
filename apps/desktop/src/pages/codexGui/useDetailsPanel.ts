import { guiText } from "../../i18n/guiText";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DiffPanelEntry } from "./detailsContext";
import { filePreviewApi, type FilePreviewData } from "./filePreview/api";

type Preview = { kind: "file"; data: FilePreviewData } | { kind: "website"; url: string };
const EMPTY_CHANGES: DiffPanelEntry = { id: "conversation-changes", get title() { return guiText("文件更改"); }, files: [] };

function release(data: FilePreviewData) {
  void filePreviewApi.close(data.sessionId).catch(error => console.error("Failed to release file preview", error));
}

export function useDetailsPanel({ selected, active, enabled }: {
  selected: string | null; active: boolean; enabled: boolean;
}) {
  const [entry, setEntry] = useState<DiffPanelEntry | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [showingChanges, setShowingChanges] = useState(true);
  const [minimized, setMinimized] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [viewId, setViewId] = useState(0);
  const opener = useRef<HTMLElement | null>(null);
  const changes = useRef(EMPTY_CHANGES);
  const request = useRef(0);
  const visible = Boolean((entry || preview) && !minimized && active && enabled);
  const rememberOpener = useCallback(() => {
    // Switching tabs inside the drawer must not replace the original conversation trigger.
    const focused = document.activeElement;
    if (focused instanceof HTMLElement && !focused.closest("[data-details-panel]")) opener.current = focused;
  }, []);
  const reveal = useCallback((diff: boolean) => {
    setShowingChanges(diff); setMinimized(false); setViewId(value => value + 1);
  }, []);
  const open = useCallback((next: DiffPanelEntry) => {
    request.current += 1; rememberOpener(); setEntry(next); reveal(true);
  }, [rememberOpener, reveal]);
  const update = useCallback((next: DiffPanelEntry) => {
    setEntry(current => current?.id === next.id ? { ...next,
      filePath: next.files.some(file => file.path === current.filePath) ? current.filePath : undefined } : current);
  }, []);
  const setConversationChanges = useCallback((next: DiffPanelEntry) => { changes.current = next; }, []);
  const close = useCallback(() => {
    request.current += 1; setEntry(null); setPreview(null); setExpanded(false); opener.current?.focus();
  }, []);
  const openFile = useCallback(async (target: Parameters<typeof filePreviewApi.open>[0]) => {
    const id = ++request.current;
    rememberOpener();
    let data: FilePreviewData | null;
    try { data = await filePreviewApi.open(target); }
    catch (error) { if (id !== request.current) return true; throw error; }
    if (id !== request.current) { if (data) release(data); return true; }
    if (!data) return false;
    setPreview({ kind: "file", data }); reveal(false);
    return true;
  }, [rememberOpener, reveal]);
  const openWebsite = useCallback((url: string) => {
    request.current += 1; rememberOpener(); setPreview({ kind: "website", url }); reveal(false);
  }, [rememberOpener, reveal]);
  useEffect(() => {
    setEntry(null); setPreview(null); setMinimized(false); setExpanded(false);
    return () => { request.current += 1; };
  }, [selected, enabled]);
  useEffect(() => {
    if (preview?.kind === "file") return () => release(preview.data);
  }, [preview]);
  const context = useMemo(() => ({ open, update, close, openFile, openWebsite, setConversationChanges,
    visible, showingChanges }), [open, update, close, openFile, openWebsite, setConversationChanges,
    visible, showingChanges]);
  return { context, entry, preview, showingChanges, visible, viewId, minimized, expanded, setExpanded,
    minimize: () => { setMinimized(true); opener.current?.focus(); },
    restore: () => setMinimized(false), showChanges: () => open(changes.current),
    showPreview: () => { request.current += 1; reveal(false); } };
}
