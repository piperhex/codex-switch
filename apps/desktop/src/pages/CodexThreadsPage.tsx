import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Button, Checkbox, Dropdown, Input, Modal, Select, Spin } from "antd";
import {
  ArchiveRestore,
  ChevronDown,
  ChevronRight,
  Copy,
  Download,
  Eye,
  FileJson,
  Folder,
  FolderOpen,
  Import,
  MoreHorizontal,
  RefreshCw,
  Search,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import {
  chooseCodexThreadPackage,
  clearCodexThreadBin,
  deleteCodexThreadsForever,
  importCodexThreads,
  loadCodexThreadBin,
  loadCodexThreads,
  loadCodexThreadTokens,
  moveCodexThreadsToBin,
  openCodexThreadPath,
  previewCodexThreadExport,
  previewCodexThreadImport,
  repairCodexThreadVisibility,
  restoreCodexThreads,
  saveCodexThreadPackage,
  syncCodexThreadIndex,
} from "../api/backend";
import type { Language } from "../i18n";
import type {
  CodexThreadBinEntry,
  CodexThreadBundlePreview,
  CodexThreadEntry,
  CodexThreadKind,
  CodexThreadTokenTotals,
  CodexThreadVisibilityReport,
} from "../types";

interface CodexThreadsPageProps {
  language: Language;
  notify: (message: string) => void;
}

const copy = {
  zh: {
    searchPlaceholder: "搜索标题和会话内容",
    clear: "清空",
    conversation: "对话",
    external: "外部",
    subagent: "子代理",
    allKinds: "全部类型",
    selectAll: "全选全部会话",
    export: "导出会话",
    import: "导入会话",
    moveToBin: "移动到回收站",
    sync: "同步会话",
    repair: "修复可见性",
    bin: "回收站",
    empty: "暂无 Codex 会话",
    noMatch: "没有匹配的会话",
    untitled: "未命名会话",
    sessions: "条会话",
    listTitle: "标题",
    sessionCount: "会话数",
    conversationTime: "对话时间",
    inputTokens: "输入",
    outputTokens: "输出",
    totalTokens: "总计",
    openFolder: "打开所在目录",
    openFile: "打开 rollout 文件",
    copyId: "复制会话 ID",
    trashTitle: "Codex 会话回收站",
    trashEmpty: "回收站为空",
    restore: "恢复",
    deleteForever: "永久删除",
    emptyBin: "清空回收站",
    close: "关闭",
    pickOne: "请至少选择一条会话",
    confirmTrash: "所选会话将移到本地回收站，可在之后恢复。",
    confirmDelete: "所选会话将被永久删除，且无法恢复。",
    confirmEmpty: "回收站中的所有会话都将被永久删除，且无法恢复。",
    transferPreview: "会话包预览",
    exportHint: "会话包只包含 rollout 文件与本地索引，不包含账号、Token、API Key 或应用设置。",
    importHint: "已存在相同 ID 的会话会自动跳过，不会覆盖本地内容。",
    packageCount: "可处理 {ready} / {total} 条，合计 {size}",
    continueExport: "选择保存位置",
    continueImport: "导入所选会话",
    transfer: "导入/导出",
    duplicate: "已存在",
    ready: "可导入",
    repairTitle: "Codex 会话不可见",
    repairMessage: "校正官方 Codex state DB 中影响侧边栏显示的会话记录，适合账号与 API Key 切换后的会话恢复。",
    repairMode: "修复方式",
    quick: "快速修复",
    quickDesc: "校正 state DB 和会话文件首条元数据，适合日常切号后恢复。",
    deep: "深度修复",
    deepDesc: "在快速修复基础上重建本地会话索引，适合仍不可见时使用。",
    sessionScope: "会话范围",
    allSessions: "全部会话",
    allSessionsDesc: "修复当前列表中的全部会话。",
    selectedSessions: "所选会话",
    selectedSessionsDesc: "仅修复已勾选的 {count} 条会话。",
    selectedEmpty: "先在列表中勾选会话。",
    preview: "查看影响范围",
    previewing: "正在查看…",
    startRepair: "开始修复",
    repairing: "正在修复…",
    previewResult: "预计更新 DB {db} 行、目录 {catalog} 行、会话文件 {files} 个。",
    loading: "正在读取 Codex 会话…",
  },
  en: {
    searchPlaceholder: "Search titles and conversation content",
    clear: "Clear",
    conversation: "Conversation",
    external: "External",
    subagent: "Subagent",
    allKinds: "All types",
    selectAll: "Select all sessions",
    export: "Export sessions",
    import: "Import sessions",
    moveToBin: "Move to Trash",
    sync: "Sync sessions",
    repair: "Repair visibility",
    bin: "Trash",
    empty: "No Codex sessions yet",
    noMatch: "No matching sessions",
    untitled: "Untitled session",
    sessions: "sessions",
    listTitle: "Title",
    sessionCount: "Sessions",
    conversationTime: "Conversation time",
    inputTokens: "Input",
    outputTokens: "Output",
    totalTokens: "Total",
    openFolder: "Open containing folder",
    openFile: "Open rollout file",
    copyId: "Copy session ID",
    trashTitle: "Codex Session Trash",
    trashEmpty: "Trash is empty",
    restore: "Restore",
    deleteForever: "Delete permanently",
    emptyBin: "Empty Trash",
    close: "Close",
    pickOne: "Select at least one session",
    confirmTrash: "Selected sessions will move to local Trash and can be restored later.",
    confirmDelete: "Selected sessions will be permanently deleted and cannot be restored.",
    confirmEmpty: "Every session in Trash will be permanently deleted and cannot be restored.",
    transferPreview: "Session package preview",
    exportHint: "The package contains rollout files and the local index only. Accounts, tokens, API keys, and settings are excluded.",
    importHint: "Sessions with the same ID are skipped and local content is never overwritten.",
    packageCount: "{ready} of {total} ready · {size}",
    continueExport: "Choose save location",
    continueImport: "Import selected sessions",
    transfer: "Import / Export",
    duplicate: "Already exists",
    ready: "Ready",
    repairTitle: "Codex sessions are not visible",
    repairMessage: "Correct session records in the official Codex state DB that affect sidebar visibility after account or API key changes.",
    repairMode: "Repair method",
    quick: "Quick repair",
    quickDesc: "Correct the state DB and first metadata record in each session file.",
    deep: "Deep repair",
    deepDesc: "Also rebuild the local session index when quick repair is not enough.",
    sessionScope: "Session scope",
    allSessions: "All sessions",
    allSessionsDesc: "Repair every session in the current list.",
    selectedSessions: "Selected sessions",
    selectedSessionsDesc: "Repair the {count} selected sessions only.",
    selectedEmpty: "Select sessions from the list first.",
    preview: "View impact",
    previewing: "Checking…",
    startRepair: "Start repair",
    repairing: "Repairing…",
    previewResult: "Expected changes: DB {db}, catalog {catalog}, rollout files {files}.",
    loading: "Loading Codex sessions…",
  },
} as const;

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

function formatTokenAmount(value: number) {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(2)}K`;
  return value.toLocaleString();
}

function relativeTime(timestamp: number | null, language: Language) {
  if (!timestamp) return "—";
  const seconds = Math.max(0, Math.floor(Date.now() / 1000 - timestamp));
  if (seconds < 3600) return language === "zh" ? `${Math.max(1, Math.floor(seconds / 60))} 分钟` : `${Math.max(1, Math.floor(seconds / 60))} min`;
  if (seconds < 86400) return language === "zh" ? `${Math.floor(seconds / 3600)} 小时` : `${Math.floor(seconds / 3600)} hr`;
  if (seconds < 604800) return language === "zh" ? `${Math.floor(seconds / 86400)} 天` : `${Math.floor(seconds / 86400)} days`;
  return language === "zh" ? `${Math.floor(seconds / 604800)} 周` : `${Math.floor(seconds / 604800)} wk`;
}

function groupLabel(cwd: string) {
  const normalized = cwd.replace(/\\/g, "/").replace(/\/$/, "");
  return normalized.split("/").filter(Boolean).at(-1) || cwd;
}

function interpolate(value: string, values: Record<string, string | number>) {
  return Object.entries(values).reduce((text, [key, replacement]) => text.replace(`{${key}}`, String(replacement)), value);
}

function HighlightedText({ value, query }: { value: string; query: string }) {
  const normalizedQuery = query.trim();
  if (!normalizedQuery) return <>{value}</>;
  const escaped = normalizedQuery.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const parts = value.split(new RegExp(`(${escaped})`, "gi"));
  return <>{parts.map((part, index) => part.toLowerCase() === normalizedQuery.toLowerCase()
    ? <mark className="thread-search-mark" key={`${part}-${index}`}>{part}</mark>
    : part)}</>;
}

export function CodexThreadsPage({ language, notify }: CodexThreadsPageProps) {
  const text = copy[language];
  const [threads, setThreads] = useState<CodexThreadEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");
  const [appliedQuery, setAppliedQuery] = useState("");
  const [kind, setKind] = useState<CodexThreadKind | "all">("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [tokens, setTokens] = useState<Record<string, CodexThreadTokenTotals>>({});
  const [binOpen, setBinOpen] = useState(false);
  const [binEntries, setBinEntries] = useState<CodexThreadBinEntry[]>([]);
  const [binSelected, setBinSelected] = useState<Set<string>>(new Set());
  const [repairOpen, setRepairOpen] = useState(false);
  const [repairMode, setRepairMode] = useState<"quick" | "deep">("quick");
  const [repairScope, setRepairScope] = useState<"all" | "selected">("all");
  const [repairPreview, setRepairPreview] = useState<CodexThreadVisibilityReport | null>(null);
  const [repairBusy, setRepairBusy] = useState(false);
  const [bundleOpen, setBundleOpen] = useState(false);
  const [bundleMode, setBundleMode] = useState<"export" | "import">("export");
  const [bundlePreview, setBundlePreview] = useState<CodexThreadBundlePreview | null>(null);
  const [bundlePath, setBundlePath] = useState<string | null>(null);
  const [bundleSelected, setBundleSelected] = useState<Set<string>>(new Set());
  const [topbarHost, setTopbarHost] = useState<HTMLElement | null>(null);
  const latestReadRef = useRef(0);
  const searchDelayRef = useRef<number | null>(null);

  const reportError = useCallback((error: unknown) => notify(error instanceof Error ? error.message : String(error)), [notify]);

  const refresh = useCallback(async (
    nextQuery: string,
    silent = false,
  ) => {
    if (!silent) setLoading(true);
    const requestId = latestReadRef.current + 1;
    latestReadRef.current = requestId;
    try {
      const result = await loadCodexThreads({ titleQuery: nextQuery, contentQuery: nextQuery });
      if (requestId !== latestReadRef.current) return;
      setThreads(result);
      const normalizedQuery = nextQuery.trim();
      setAppliedQuery(normalizedQuery);
      if (!silent) setExpanded(normalizedQuery ? new Set(result.map((item) => item.cwd)) : new Set());
      setSelected((current) => new Set([...current].filter((id) => result.some((item) => item.sessionId === id))));
    } catch (error) {
      if (!silent) reportError(error);
    } finally {
      if (!silent) setLoading(false);
    }
  }, [reportError]);

  useEffect(() => { void refresh(""); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setTopbarHost(document.getElementById("codex-thread-topbar-actions")); }, []);
  useEffect(() => () => {
    if (searchDelayRef.current !== null) window.clearTimeout(searchDelayRef.current);
  }, []);
  const visibleThreads = useMemo(() => kind === "all" ? threads : threads.filter((item) => item.sessionKind === kind), [kind, threads]);
  const groups = useMemo(() => {
    const result = new Map<string, CodexThreadEntry[]>();
    for (const item of visibleThreads) result.set(item.cwd, [...(result.get(item.cwd) ?? []), item]);
    return [...result.entries()].map(([cwd, items]) => ({
      cwd,
      items: items.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0)),
      updatedAt: Math.max(...items.map((item) => item.updatedAt ?? 0)),
    })).sort((a, b) => b.updatedAt - a.updatedAt);
  }, [visibleThreads]);

  const allVisibleSelected = visibleThreads.length > 0 && visibleThreads.every((item) => selected.has(item.sessionId));
  const someVisibleSelected = visibleThreads.some((item) => selected.has(item.sessionId));
  const toggleAll = () => setSelected(allVisibleSelected ? new Set() : new Set(visibleThreads.map((item) => item.sessionId)));
  const toggleThread = (id: string) => setSelected((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const toggleGroup = async (cwd: string, items: CodexThreadEntry[]) => {
    const next = new Set(expanded);
    if (next.has(cwd)) next.delete(cwd); else next.add(cwd);
    setExpanded(next);
    if (!expanded.has(cwd)) {
      const missing = items.map((item) => item.sessionId).filter((id) => !tokens[id]);
      if (missing.length) {
        try {
          const totals = await loadCodexThreadTokens(missing);
          setTokens((current) => ({ ...current, ...Object.fromEntries(totals.map((item) => [item.sessionId, item])) }));
        } catch {
          // Token details are optional; the session list remains usable if a rollout is incomplete.
        }
      }
    }
  };

  const requireSelection = () => {
    if (selected.size) return true;
    notify(text.pickOne);
    return false;
  };

  const confirmTrash = () => {
    if (!requireSelection()) return;
    Modal.confirm({
      title: text.moveToBin,
      content: <span className="compact-confirm-copy">{text.confirmTrash}</span>,
      okText: text.moveToBin,
      cancelText: text.close,
      okButtonProps: { danger: true },
      onOk: async () => {
        const result = await moveCodexThreadsToBin([...selected]);
        notify(result.message);
        setSelected(new Set());
        await refresh(appliedQuery, true);
      },
    });
  };

  const openExport = async () => {
    if (!requireSelection()) return;
    setBusy(true);
    try {
      const preview = await previewCodexThreadExport([...selected]);
      setBundleMode("export");
      setBundlePreview(preview);
      setBundleSelected(new Set(preview.items.map((item) => item.sessionId)));
      setBundlePath(null);
      setBundleOpen(true);
    } catch (error) { reportError(error); } finally { setBusy(false); }
  };

  const openImport = async () => {
    setBusy(true);
    try {
      const path = await chooseCodexThreadPackage();
      if (!path) return;
      const preview = await previewCodexThreadImport(path);
      setBundleMode("import");
      setBundlePreview(preview);
      setBundleSelected(new Set(preview.items.filter((item) => item.status === "ready").map((item) => item.sessionId)));
      setBundlePath(path);
      setBundleOpen(true);
    } catch (error) { reportError(error); } finally { setBusy(false); }
  };

  const commitBundle = async () => {
    if (!bundleSelected.size) { notify(text.pickOne); return; }
    setBusy(true);
    try {
      const result = bundleMode === "export"
        ? await saveCodexThreadPackage([...bundleSelected])
        : bundlePath ? await importCodexThreads(bundlePath, [...bundleSelected]) : null;
      if (!result) return;
      notify(result.message);
      setBundleOpen(false);
      await refresh(appliedQuery, true);
    } catch (error) { reportError(error); } finally { setBusy(false); }
  };

  const openBin = async () => {
    setBusy(true);
    try {
      setBinEntries(await loadCodexThreadBin());
      setBinSelected(new Set());
      setBinOpen(true);
    } catch (error) { reportError(error); } finally { setBusy(false); }
  };

  const reloadBin = async () => {
    setBinEntries(await loadCodexThreadBin());
    setBinSelected(new Set());
    await refresh(appliedQuery, true);
  };

  const restoreFromBin = async () => {
    if (!binSelected.size) { notify(text.pickOne); return; }
    setBusy(true);
    try { const result = await restoreCodexThreads([...binSelected]); notify(result.message); await reloadBin(); }
    catch (error) { reportError(error); } finally { setBusy(false); }
  };

  const confirmPermanentDelete = (empty = false) => Modal.confirm({
    title: empty ? text.emptyBin : text.deleteForever,
    content: <span className="compact-confirm-copy">{empty ? text.confirmEmpty : text.confirmDelete}</span>,
    okText: empty ? text.emptyBin : text.deleteForever,
    cancelText: text.close,
    okButtonProps: { danger: true },
    onOk: async () => {
      if (!empty && !binSelected.size) { notify(text.pickOne); return; }
      const result = empty ? await clearCodexThreadBin() : await deleteCodexThreadsForever([...binSelected]);
      notify(result.message);
      await reloadBin();
    },
  });

  const runSync = async () => {
    setBusy(true);
    try {
      await refresh(appliedQuery, true);
      const result = await syncCodexThreadIndex();
      notify(result.message);
      await refresh(appliedQuery, true);
    }
    catch (error) { reportError(error); } finally { setBusy(false); }
  };

  const repairIds = repairScope === "selected" ? [...selected] : null;
  const runRepair = async (dryRun: boolean) => {
    if (repairScope === "selected" && !selected.size) { notify(text.selectedEmpty); return; }
    setRepairBusy(true);
    try {
      const result = await repairCodexThreadVisibility({ mode: repairMode, sessionIds: repairIds, dryRun });
      if (dryRun) setRepairPreview(result);
      else {
        notify(result.message);
        setRepairOpen(false);
        setRepairPreview(null);
        await refresh(appliedQuery, true);
      }
    } catch (error) { reportError(error); } finally { setRepairBusy(false); }
  };

  const cancelQueuedSearch = () => {
    if (searchDelayRef.current === null) return;
    window.clearTimeout(searchDelayRef.current);
    searchDelayRef.current = null;
  };
  const queueSearch = (nextQuery: string) => {
    cancelQueuedSearch();
    searchDelayRef.current = window.setTimeout(() => {
      searchDelayRef.current = null;
      void refresh(nextQuery);
    }, 300);
  };
  const search = () => {
    cancelQueuedSearch();
    void refresh(query);
  };
  const clearSearch = () => {
    cancelQueuedSearch();
    setQuery("");
    void refresh("");
  };

  const topbarActions = (
    <>
      <button className="refresh-all" disabled={busy} onClick={() => void runSync()}>
        <RefreshCw className={busy ? "spin" : undefined} size={16} />{text.sync}
      </button>
      <Dropdown trigger={["click"]} menu={{
        items: [
          { key: "import", icon: <Import size={15} />, label: text.import },
          { key: "export", icon: <Download size={15} />, label: `${text.export} (${selected.size})`, disabled: !selected.size },
        ],
        onClick: ({ key }) => {
          if (key === "import") void openImport();
          if (key === "export") void openExport();
        },
      }}>
        <button className="refresh-all" disabled={busy}>
          <Upload size={16} />{text.transfer}<ChevronDown size={14} />
        </button>
      </Dropdown>
      <button className="refresh-all" disabled={busy} onClick={() => { setRepairPreview(null); setRepairOpen(true); }}>
        <Eye size={16} />{text.repair}
      </button>
      <button className="refresh-all" disabled={busy} onClick={() => void openBin()}>
        <ArchiveRestore size={16} />{text.bin}
      </button>
    </>
  );

  return (
    <>
    {topbarHost && createPortal(topbarActions, topbarHost)}
    <div className="codex-thread-manager">
      <div className="codex-thread-toolbar">
        <Input
          value={query}
          onChange={(event) => {
            const nextQuery = event.target.value;
            setQuery(nextQuery);
            queueSearch(nextQuery);
          }}
          onPressEnter={search}
          prefix={<Search size={17} />}
          placeholder={text.searchPlaceholder}
          suffix={query ? <button className="thread-input-clear" onClick={clearSearch} aria-label={text.clear}><X size={15} /></button> : null}
        />
        <Select value={kind} onChange={setKind} options={[
          { value: "conversation", label: text.conversation },
          { value: "external", label: text.external },
          { value: "subagent", label: text.subagent },
          { value: "all", label: text.allKinds },
        ]} />
        <Button icon={<Trash2 size={16} />} danger disabled={!selected.size || busy} onClick={confirmTrash}>
          {text.moveToBin} ({selected.size})
        </Button>
      </div>

      <div className="codex-thread-list">
        <div className="thread-list-header">
          <span aria-hidden="true" />
          <Checkbox
            checked={allVisibleSelected}
            indeterminate={someVisibleSelected && !allVisibleSelected}
            disabled={!visibleThreads.length}
            onChange={() => toggleAll()}
            aria-label={text.selectAll}
          />
          <span aria-hidden="true" />
          <strong>{text.listTitle}</strong>
          <span className="thread-list-header-count">{text.sessionCount}</span>
          <span className="thread-list-header-time">{text.conversationTime}</span>
        </div>
        {loading ? <div className="thread-empty"><Spin /><span>{text.loading}</span></div> : groups.length ? groups.map((group) => {
          const isOpen = expanded.has(group.cwd);
          return (
            <section className="thread-workspace" key={group.cwd}>
              <div className="thread-workspace-row" onDoubleClick={() => void toggleGroup(group.cwd, group.items)}>
                <button className="thread-expand" onClick={() => void toggleGroup(group.cwd, group.items)} aria-label={isOpen ? text.close : text.sessions}>
                  {isOpen ? <ChevronDown size={17} /> : <ChevronRight size={17} />}
                </button>
                <Checkbox
                  checked={group.items.every((item) => selected.has(item.sessionId))}
                  indeterminate={group.items.some((item) => selected.has(item.sessionId)) && !group.items.every((item) => selected.has(item.sessionId))}
                  onChange={(event) => setSelected((current) => {
                    const next = new Set(current);
                    group.items.forEach((item) => event.target.checked ? next.add(item.sessionId) : next.delete(item.sessionId));
                    return next;
                  })}
                />
                <Folder size={20} />
                <div className="thread-workspace-copy">
                  <strong>{groupLabel(group.cwd)}</strong>
                  <span title={group.cwd}>{group.cwd}</span>
                </div>
                <span className="thread-workspace-count">{group.items.length} {text.sessions}</span>
                <time>{relativeTime(group.updatedAt, language)}</time>
              </div>
              {isOpen && <div className="thread-session-list">{group.items.map((thread) => {
                const stats = tokens[thread.sessionId];
                return (
                  <div className="thread-session-row" key={thread.sessionId}>
                    <Checkbox checked={selected.has(thread.sessionId)} onChange={() => toggleThread(thread.sessionId)} />
                    <FileJson size={18} />
                    <div className="thread-session-copy">
                      <strong><HighlightedText value={thread.title || text.untitled} query={appliedQuery} /></strong>
                      <span>{thread.sessionId}</span>
                      {thread.matchExcerpt && <p className="thread-match-excerpt">
                        <Search size={12} />
                        <span><HighlightedText value={thread.matchExcerpt} query={appliedQuery} /></span>
                      </p>}
                    </div>
                    <div className="thread-token-stats">
                      {stats ? <>
                        <span>{text.inputTokens} {formatTokenAmount(stats.inputTokens)}</span>
                        <span>{text.outputTokens} {formatTokenAmount(stats.outputTokens)}</span>
                        <strong>{text.totalTokens} {formatTokenAmount(stats.totalTokens)}</strong>
                      </> : <span>{formatSize(thread.sizeBytes)}</span>}
                    </div>
                    <time>{relativeTime(thread.updatedAt, language)}</time>
                    <Dropdown trigger={["click"]} menu={{ items: [
                      { key: "folder", icon: <FolderOpen size={15} />, label: text.openFolder },
                      { key: "file", icon: <FileJson size={15} />, label: text.openFile },
                      { key: "copy", icon: <Copy size={15} />, label: text.copyId },
                    ], onClick: ({ key }) => {
                      if (key === "copy") void navigator.clipboard.writeText(thread.sessionId).then(() => notify(text.copyId));
                      else void openCodexThreadPath(thread.sessionId, key === "folder").catch(reportError);
                    } }}>
                      <button className="thread-more" aria-label="More"><MoreHorizontal size={17} /></button>
                    </Dropdown>
                  </div>
                );
              })}</div>}
            </section>
          );
        }) : <div className="thread-empty"><FolderOpen size={30} /><span>{appliedQuery ? text.noMatch : text.empty}</span></div>}
      </div>

      <Modal open={binOpen} title={text.trashTitle} width={760} onCancel={() => setBinOpen(false)} footer={[
        <Button key="empty" danger disabled={!binEntries.length || busy} onClick={() => confirmPermanentDelete(true)}>{text.emptyBin}</Button>,
        <Button key="delete" danger disabled={!binSelected.size || busy} onClick={() => confirmPermanentDelete(false)}>{text.deleteForever}</Button>,
        <Button key="restore" type="primary" disabled={!binSelected.size || busy} onClick={() => void restoreFromBin()} icon={<ArchiveRestore size={16} />}>{text.restore}</Button>,
        <Button key="close" onClick={() => setBinOpen(false)}>{text.close}</Button>,
      ]}>
        <div className="thread-bin-list">{binEntries.length ? binEntries.map((entry) => (
          <label className="thread-bin-row" key={entry.sessionId}>
            <Checkbox checked={binSelected.has(entry.sessionId)} onChange={() => setBinSelected((current) => {
              const next = new Set(current); if (next.has(entry.sessionId)) next.delete(entry.sessionId); else next.add(entry.sessionId); return next;
            })} />
            <Trash2 size={18} />
            <span><strong>{entry.title || text.untitled}</strong><small>{entry.cwd}</small></span>
            <time>{relativeTime(entry.deletedAt, language)}</time>
            <em>{formatSize(entry.sizeBytes)}</em>
          </label>
        )) : <div className="thread-empty"><Trash2 size={28} /><span>{text.trashEmpty}</span></div>}</div>
      </Modal>

      <Modal open={bundleOpen} title={text.transferPreview} width={800} onCancel={() => setBundleOpen(false)} okText={bundleMode === "export" ? text.continueExport : text.continueImport} cancelText={text.close} confirmLoading={busy} onOk={() => void commitBundle()}>
        {bundlePreview && <>
          <p className="thread-modal-hint">{bundleMode === "export" ? text.exportHint : text.importHint}</p>
          <strong className="thread-package-summary">{interpolate(text.packageCount, { ready: bundlePreview.readyCount, total: bundlePreview.totalCount, size: formatSize(bundlePreview.totalSizeBytes) })}</strong>
          <div className="thread-package-list">{bundlePreview.items.map((item) => {
            const ready = item.status === "ready";
            return <label className={`thread-package-row${ready ? "" : " is-disabled"}`} key={item.sessionId}>
              <Checkbox disabled={!ready} checked={bundleSelected.has(item.sessionId)} onChange={() => setBundleSelected((current) => {
                const next = new Set(current); if (next.has(item.sessionId)) next.delete(item.sessionId); else next.add(item.sessionId); return next;
              })} />
              <span><strong>{item.title || text.untitled}</strong><small>{item.cwd}</small></span>
              <em>{ready ? text.ready : text.duplicate}</em>
              <b>{formatSize(item.sizeBytes)}</b>
            </label>;
          })}</div>
        </>}
      </Modal>

      <Modal className="thread-repair-modal" open={repairOpen} title={text.repairTitle} width={880} onCancel={() => setRepairOpen(false)} footer={[
        <Button key="preview" icon={<Search size={16} />} loading={repairBusy} onClick={() => void runRepair(true)}>{repairBusy ? text.previewing : text.preview}</Button>,
        <Button key="repair" type="primary" icon={<RefreshCw size={16} />} loading={repairBusy} onClick={() => void runRepair(false)}>{repairBusy ? text.repairing : text.startRepair}</Button>,
      ]}>
        <p className="thread-modal-hint">{text.repairMessage}</p>
        <h4>{text.repairMode}</h4>
        <div className="thread-choice-grid">
          <button className={repairMode === "quick" ? "selected" : ""} onClick={() => { setRepairMode("quick"); setRepairPreview(null); }}><strong>{text.quick}</strong><span>{text.quickDesc}</span></button>
          <button className={repairMode === "deep" ? "selected" : ""} onClick={() => { setRepairMode("deep"); setRepairPreview(null); }}><strong>{text.deep}</strong><span>{text.deepDesc}</span></button>
        </div>
        <h4>{text.sessionScope}</h4>
        <div className="thread-choice-grid">
          <button className={repairScope === "all" ? "selected" : ""} onClick={() => { setRepairScope("all"); setRepairPreview(null); }}><strong>{text.allSessions}</strong><span>{text.allSessionsDesc}</span></button>
          <button className={repairScope === "selected" ? "selected" : ""} disabled={!selected.size} onClick={() => { setRepairScope("selected"); setRepairPreview(null); }}><strong>{text.selectedSessions}</strong><span>{selected.size ? interpolate(text.selectedSessionsDesc, { count: selected.size }) : text.selectedEmpty}</span></button>
        </div>
        {repairPreview && <div className="thread-repair-preview">{interpolate(text.previewResult, { db: repairPreview.databaseRowCount, catalog: repairPreview.catalogRowCount, files: repairPreview.rolloutCount })}</div>}
      </Modal>
    </div>
    </>
  );
}
