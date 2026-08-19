import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Modal } from "antd";
import { restartChatGpt, syncCodexThreadIndex } from "../api/backend";
import type { Language } from "../i18n";
import { threadCopy } from "./codex-threads/copy";
import { ThreadList } from "./codex-threads/ThreadList";
import { RepairModal, TransferModal, TrashModal } from "./codex-threads/ThreadModals";
import { ThreadToolbar } from "./codex-threads/ThreadToolbar";
import { ThreadTopbar } from "./codex-threads/ThreadTopbar";
import { useRepair } from "./codex-threads/useRepair";
import { useThreadList } from "./codex-threads/useThreadList";
import { useTransfer } from "./codex-threads/useTransfer";
import { useTrash } from "./codex-threads/useTrash";

interface CodexThreadsPageProps {
  language: Language;
  notify: (message: string) => void;
}

export function CodexThreadsPage({ language, notify }: CodexThreadsPageProps) {
  const text = threadCopy[language];
  const [busy, setBusy] = useState(false);
  const [topbarHost, setTopbarHost] = useState<HTMLElement | null>(null);
  const reportError = useCallback(
    (error: unknown) => notify(error instanceof Error ? error.message : String(error)),
    [notify],
  );
  const list = useThreadList(reportError);
  const refresh = () => list.refresh(list.appliedQuery, true);
  const transfer = useTransfer({
    selected: list.selected, text, notify, reportError, refresh, setBusy,
  });
  const trash = useTrash({
    selected: list.selected,
    clearSelection: () => list.setSelected(new Set()),
    text,
    notify,
    reportError,
    refresh,
    setBusy,
  });
  const repair = useRepair({ selected: list.selected, text, notify, reportError, refresh });

  useEffect(() => {
    setTopbarHost(document.getElementById("codex-thread-topbar-actions"));
  }, []);

  const runSync = async () => {
    setBusy(true);
    try {
      await refresh();
      const result = await syncCodexThreadIndex();
      notify(result.message);
      await refresh();
    } catch (error) {
      reportError(error);
    } finally {
      setBusy(false);
    }
  };

  const runRestartChatGpt = async () => {
    setBusy(true);
    try {
      await restartChatGpt();
      notify(text.restartChatGptSuccess);
    } catch (error) {
      reportError(error);
    } finally {
      setBusy(false);
    }
  };

  const confirmRestartChatGpt = () => {
    Modal.confirm({
      title: text.restartChatGptConfirmTitle,
      content: <span className="compact-confirm-copy">{text.restartChatGptConfirmDescription}</span>,
      okText: text.restartChatGpt,
      cancelText: text.close,
      okButtonProps: { danger: true },
      onOk: runRestartChatGpt,
    });
  };

  return (
    <>
      {topbarHost && createPortal(
        <ThreadTopbar
          text={text}
          busy={busy}
          selectedCount={list.selected.size}
          runSync={() => void runSync()}
          restartChatGpt={confirmRestartChatGpt}
          openImport={() => void transfer.openImport()}
          openExport={() => void transfer.openExport()}
          openRepair={repair.openModal}
          openBin={() => void trash.openBin()}
        />,
        topbarHost,
      )}
      <div className="codex-thread-manager">
        <ThreadToolbar
          text={text}
          query={list.query}
          setQuery={list.setQuery}
          queueSearch={list.queueSearch}
          search={list.search}
          clearSearch={list.clearSearch}
          kind={list.kind}
          setKind={list.setKind}
          selectedCount={list.selected.size}
          busy={busy}
          confirmTrash={trash.confirmMove}
        />
        <ThreadList
          language={language}
          text={text}
          loading={list.loading}
          appliedQuery={list.appliedQuery}
          groups={list.groups}
          selected={list.selected}
          setSelected={list.setSelected}
          expanded={list.expanded}
          tokens={list.tokens}
          visibleCount={list.visibleThreads.length}
          allVisibleSelected={list.allVisibleSelected}
          someVisibleSelected={list.someVisibleSelected}
          toggleAll={list.toggleAll}
          toggleThread={list.toggleThread}
          toggleGroup={list.toggleGroup}
          notify={notify}
          reportError={reportError}
        />
        <TrashModal
          open={trash.open}
          setOpen={trash.setOpen}
          entries={trash.entries}
          selected={trash.selected}
          setSelected={trash.setSelected}
          busy={busy}
          text={text}
          language={language}
          restore={() => void trash.restore()}
          confirmDelete={trash.confirmDelete}
        />
        <TransferModal
          open={transfer.open}
          setOpen={transfer.setOpen}
          mode={transfer.mode}
          preview={transfer.preview}
          selected={transfer.selected}
          setSelected={transfer.setSelected}
          busy={busy}
          text={text}
          commit={() => void transfer.commit()}
        />
        <RepairModal
          open={repair.open}
          setOpen={repair.setOpen}
          mode={repair.mode}
          updateMode={repair.updateMode}
          scope={repair.scope}
          updateScope={repair.updateScope}
          preview={repair.preview}
          busy={repair.busy}
          selectedCount={list.selected.size}
          text={text}
          run={(dryRun) => void repair.run(dryRun)}
        />
      </div>
    </>
  );
}
