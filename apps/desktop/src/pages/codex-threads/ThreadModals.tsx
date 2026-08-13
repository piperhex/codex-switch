import { Button, Checkbox, Modal } from "antd";
import { ArchiveRestore, RefreshCw, Search, Trash2 } from "lucide-react";
import type { Dispatch, SetStateAction } from "react";
import type {
  CodexThreadBinEntry, CodexThreadBundlePreview, CodexThreadVisibilityReport,
} from "../../types";
import type { Language } from "../../i18n";
import type { ThreadCopy } from "./copy";
import { formatSize, interpolate, relativeTime } from "./utils";

interface TrashModalProps {
  open: boolean;
  setOpen: Dispatch<SetStateAction<boolean>>;
  entries: CodexThreadBinEntry[];
  selected: Set<string>;
  setSelected: Dispatch<SetStateAction<Set<string>>>;
  busy: boolean;
  text: ThreadCopy;
  language: Language;
  restore: () => void;
  confirmDelete: (empty?: boolean) => void;
}

export function TrashModal(props: TrashModalProps) {
  const { open, setOpen, entries, selected, setSelected, busy, text, language } = props;
  const { restore, confirmDelete } = props;
  const toggleEntry = (sessionId: string) => setSelected((current) => {
    const next = new Set(current);
    if (next.has(sessionId)) next.delete(sessionId);
    else next.add(sessionId);
    return next;
  });
  return (
    <Modal open={open} title={text.trashTitle} width={760} onCancel={() => setOpen(false)} footer={[
      <Button key="empty" danger disabled={!entries.length || busy} onClick={() => confirmDelete(true)}>
        {text.emptyBin}
      </Button>,
      <Button key="delete" danger disabled={!selected.size || busy} onClick={() => confirmDelete(false)}>
        {text.deleteForever}
      </Button>,
      <Button
        key="restore"
        type="primary"
        disabled={!selected.size || busy}
        onClick={restore}
        icon={<ArchiveRestore size={16} />}
      >
        {text.restore}
      </Button>,
      <Button key="close" onClick={() => setOpen(false)}>{text.close}</Button>,
    ]}>
      <div className="thread-bin-list">
        {entries.length ? entries.map((entry) => (
          <label className="thread-bin-row" key={entry.sessionId}>
            <Checkbox checked={selected.has(entry.sessionId)} onChange={() => toggleEntry(entry.sessionId)} />
            <Trash2 size={18} />
            <span><strong>{entry.title || text.untitled}</strong><small>{entry.cwd}</small></span>
            <time>{relativeTime(entry.deletedAt, language)}</time>
            <em>{formatSize(entry.sizeBytes)}</em>
          </label>
        )) : (
          <div className="thread-empty"><Trash2 size={28} /><span>{text.trashEmpty}</span></div>
        )}
      </div>
    </Modal>
  );
}

interface TransferModalProps {
  open: boolean;
  setOpen: Dispatch<SetStateAction<boolean>>;
  mode: "export" | "import";
  preview: CodexThreadBundlePreview | null;
  selected: Set<string>;
  setSelected: Dispatch<SetStateAction<Set<string>>>;
  busy: boolean;
  text: ThreadCopy;
  commit: () => void;
}

export function TransferModal(props: TransferModalProps) {
  const { open, setOpen, mode, preview, selected, setSelected, busy, text, commit } = props;
  const toggleItem = (sessionId: string) => setSelected((current) => {
    const next = new Set(current);
    if (next.has(sessionId)) next.delete(sessionId);
    else next.add(sessionId);
    return next;
  });
  return (
    <Modal
      open={open}
      title={text.transferPreview}
      width={800}
      onCancel={() => setOpen(false)}
      okText={mode === "export" ? text.continueExport : text.continueImport}
      cancelText={text.close}
      confirmLoading={busy}
      onOk={commit}
    >
      {preview && (
        <>
          <p className="thread-modal-hint">{mode === "export" ? text.exportHint : text.importHint}</p>
          <strong className="thread-package-summary">
            {interpolate(text.packageCount, {
              ready: preview.readyCount,
              total: preview.totalCount,
              size: formatSize(preview.totalSizeBytes),
            })}
          </strong>
          <div className="thread-package-list">
            {preview.items.map((item) => {
              const ready = item.status === "ready";
              return (
                <label className={`thread-package-row${ready ? "" : " is-disabled"}`} key={item.sessionId}>
                  <Checkbox
                    disabled={!ready}
                    checked={selected.has(item.sessionId)}
                    onChange={() => toggleItem(item.sessionId)}
                  />
                  <span><strong>{item.title || text.untitled}</strong><small>{item.cwd}</small></span>
                  <em>{ready ? text.ready : text.duplicate}</em>
                  <b>{formatSize(item.sizeBytes)}</b>
                </label>
              );
            })}
          </div>
        </>
      )}
    </Modal>
  );
}

interface RepairModalProps {
  open: boolean;
  setOpen: Dispatch<SetStateAction<boolean>>;
  mode: "quick" | "deep";
  updateMode: (mode: "quick" | "deep") => void;
  scope: "all" | "selected";
  updateScope: (scope: "all" | "selected") => void;
  preview: CodexThreadVisibilityReport | null;
  busy: boolean;
  selectedCount: number;
  text: ThreadCopy;
  run: (dryRun: boolean) => void;
}

export function RepairModal(props: RepairModalProps) {
  const { open, setOpen, mode, updateMode, scope, updateScope, preview, busy, selectedCount, text, run } = props;
  return (
    <Modal className="thread-repair-modal" open={open} title={text.repairTitle} width={880}
      onCancel={() => setOpen(false)} footer={[
        <Button key="preview" icon={<Search size={16} />} loading={busy} onClick={() => run(true)}>
          {busy ? text.previewing : text.preview}
        </Button>,
        <Button key="repair" type="primary" icon={<RefreshCw size={16} />} loading={busy}
          onClick={() => run(false)}>
          {busy ? text.repairing : text.startRepair}
        </Button>,
      ]}>
      <p className="thread-modal-hint">{text.repairMessage}</p>
      <h4>{text.repairMode}</h4>
      <div className="thread-choice-grid">
        <button className={mode === "quick" ? "selected" : ""} onClick={() => updateMode("quick")}>
          <strong>{text.quick}</strong><span>{text.quickDesc}</span>
        </button>
        <button className={mode === "deep" ? "selected" : ""} onClick={() => updateMode("deep")}>
          <strong>{text.deep}</strong><span>{text.deepDesc}</span>
        </button>
      </div>
      <h4>{text.sessionScope}</h4>
      <div className="thread-choice-grid">
        <button className={scope === "all" ? "selected" : ""} onClick={() => updateScope("all")}>
          <strong>{text.allSessions}</strong><span>{text.allSessionsDesc}</span>
        </button>
        <button className={scope === "selected" ? "selected" : ""} disabled={!selectedCount}
          onClick={() => updateScope("selected")}>
          <strong>{text.selectedSessions}</strong>
          <span>{selectedCount
            ? interpolate(text.selectedSessionsDesc, { count: selectedCount })
            : text.selectedEmpty}</span>
        </button>
      </div>
      {preview && (
        <div className="thread-repair-preview">
          {interpolate(text.previewResult, {
            db: preview.databaseRowCount,
            catalog: preview.catalogRowCount,
            files: preview.rolloutCount,
          })}
        </div>
      )}
    </Modal>
  );
}
