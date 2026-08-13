import { useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import {
  chooseCodexThreadPackage,
  importCodexThreads,
  previewCodexThreadExport,
  previewCodexThreadImport,
  saveCodexThreadPackage,
} from "../../api/backend";
import type { CodexThreadBundlePreview } from "../../types";
import type { ThreadCopy } from "./copy";

interface TransferOptions {
  selected: Set<string>;
  text: ThreadCopy;
  notify: (message: string) => void;
  reportError: (error: unknown) => void;
  refresh: () => Promise<void>;
  setBusy: Dispatch<SetStateAction<boolean>>;
}

export function useTransfer(options: TransferOptions) {
  const { selected, text, notify, reportError, refresh, setBusy } = options;
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"export" | "import">("export");
  const [preview, setPreview] = useState<CodexThreadBundlePreview | null>(null);
  const [path, setPath] = useState<string | null>(null);
  const [bundleSelected, setBundleSelected] = useState<Set<string>>(new Set());

  const openExport = async () => {
    if (!selected.size) {
      notify(text.pickOne);
      return;
    }
    setBusy(true);
    try {
      const nextPreview = await previewCodexThreadExport([...selected]);
      setMode("export");
      setPreview(nextPreview);
      setBundleSelected(new Set(nextPreview.items.map((item) => item.sessionId)));
      setPath(null);
      setOpen(true);
    } catch (error) {
      reportError(error);
    } finally {
      setBusy(false);
    }
  };
  const openImport = async () => {
    setBusy(true);
    try {
      const nextPath = await chooseCodexThreadPackage();
      if (!nextPath) return;
      const nextPreview = await previewCodexThreadImport(nextPath);
      setMode("import");
      setPreview(nextPreview);
      setBundleSelected(new Set(
        nextPreview.items.filter((item) => item.status === "ready").map((item) => item.sessionId),
      ));
      setPath(nextPath);
      setOpen(true);
    } catch (error) {
      reportError(error);
    } finally {
      setBusy(false);
    }
  };
  const commit = async () => {
    if (!bundleSelected.size) {
      notify(text.pickOne);
      return;
    }
    setBusy(true);
    try {
      const result = mode === "export"
        ? await saveCodexThreadPackage([...bundleSelected])
        : path ? await importCodexThreads(path, [...bundleSelected]) : null;
      if (!result) return;
      notify(result.message);
      setOpen(false);
      await refresh();
    } catch (error) {
      reportError(error);
    } finally {
      setBusy(false);
    }
  };

  return {
    open, setOpen, mode, preview, selected: bundleSelected, setSelected: setBundleSelected,
    openExport, openImport, commit,
  };
}
