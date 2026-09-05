import { useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { Modal } from "antd";
import {
  clearCodexThreadBin,
  deleteCodexThreadsForever,
  loadCodexThreadBin,
  moveCodexThreadsToBin,
  restoreCodexThreads,
} from "../../api/backend";
import type { CodexThreadBinEntry } from "../../types";
import type { ThreadCopy } from "./copy";

interface TrashOptions {
  selected: Set<string>;
  clearSelection: () => void;
  text: ThreadCopy;
  notify: (message: string) => void;
  reportError: (error: unknown) => void;
  refresh: () => Promise<void>;
  setBusy: Dispatch<SetStateAction<boolean>>;
}

export function useTrash(options: TrashOptions) {
  const { selected, clearSelection, text, notify, reportError, refresh, setBusy } = options;
  const [open, setOpen] = useState(false);
  const [entries, setEntries] = useState<CodexThreadBinEntry[]>([]);
  const [binSelected, setBinSelected] = useState<Set<string>>(new Set());

  const openBin = async () => {
    setBusy(true);
    try {
      setEntries(await loadCodexThreadBin());
      setBinSelected(new Set());
      setOpen(true);
    } catch (error) {
      reportError(error);
    } finally {
      setBusy(false);
    }
  };
  const reload = async () => {
    setEntries(await loadCodexThreadBin());
    setBinSelected(new Set());
    await refresh();
  };
  const restore = async () => {
    if (!binSelected.size) {
      notify(text.pickOne);
      return;
    }
    setBusy(true);
    try {
      const result = await restoreCodexThreads([...binSelected]);
      notify(result.message);
      await reload();
    } catch (error) {
      reportError(error);
    } finally {
      setBusy(false);
    }
  };
  const confirmDelete = (empty = false) => Modal.confirm({
    title: empty ? text.emptyBin : text.deleteForever,
    content: <span className="compact-confirm-copy">{empty ? text.confirmEmpty : text.confirmDelete}</span>,
    okText: empty ? text.emptyBin : text.deleteForever,
    cancelText: text.close,
    okButtonProps: { danger: true },
    onOk: async () => {
      if (!empty && !binSelected.size) {
        notify(text.pickOne);
        return;
      }
      setBusy(true);
      try {
        const result = empty
          ? await clearCodexThreadBin()
          : await deleteCodexThreadsForever([...binSelected]);
        notify(result.message);
        await reload();
      } finally {
        setBusy(false);
      }
    },
  });
  const confirmMove = () => {
    if (!selected.size) {
      notify(text.pickOne);
      return;
    }
    Modal.confirm({
      title: text.moveToBin,
      content: <span className="compact-confirm-copy">{text.confirmTrash}</span>,
      okText: text.moveToBin,
      cancelText: text.close,
      okButtonProps: { danger: true },
      onOk: async () => {
        setBusy(true);
        try {
          const result = await moveCodexThreadsToBin([...selected]);
          notify(result.message);
          clearSelection();
        } finally {
          setBusy(false);
          await refresh();
        }
      },
    });
  };

  return {
    open, setOpen, entries, selected: binSelected, setSelected: setBinSelected,
    openBin, restore, confirmDelete, confirmMove,
  };
}
