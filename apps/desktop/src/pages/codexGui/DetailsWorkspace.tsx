import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { FileDiff, Maximize2, Minimize2, Minus, PanelRightOpen, X } from "lucide-react";
import { DetailsContext, type DiffPanelEntry } from "./detailsContext";
import { DiffDocument } from "./DiffView";
import { useDrawerResize } from "./useDrawerResize";
import styles from "./DetailsWorkspace.module.less";

const MIN_CHAT_WIDTH = 520;

export function DetailsWorkspace({ selected, active, children }: {
  selected: string | null; active: boolean; children: ReactNode;
}) {
  const host = useRef<HTMLDivElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const panelId = useId();
  const [entry, setEntry] = useState<DiffPanelEntry | null>(null);
  // Explicit opens reset collapsed files and scroll; live updates preserve the current view.
  const [viewId, setViewId] = useState(0);
  const [minimized, setMinimized] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const resize = useDrawerResize(host);
  const visible = Boolean(entry && !minimized && active);
  const docked = visible && !expanded && resize.available - resize.width >= MIN_CHAT_WIDTH;
  const width = expanded ? resize.available : resize.width;
  const open = useCallback((next: DiffPanelEntry) => {
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setEntry(next); setMinimized(false); setViewId((value) => value + 1);
  }, []);
  const update = useCallback((next: DiffPanelEntry) => {
    setEntry((current) => current?.id === next.id ? { ...next,
      filePath: next.files.some((file) => file.path === current.filePath) ? current.filePath : undefined } : current);
  }, []);
  const close = useCallback(() => { setEntry(null); setExpanded(false); opener.current?.focus(); }, []);
  const context = useMemo(() => ({ open, update, close, visible }), [open, update, close, visible]);
  useEffect(() => { setEntry(null); setMinimized(false); setExpanded(false); }, [selected]);
  useEffect(() => { if (visible) closeButton.current?.focus(); }, [visible, viewId]);
  useEffect(() => { if (!visible || expanded) resize.cancel(); }, [visible, expanded, resize.cancel]);
  return <DetailsContext.Provider value={context}>
    <div ref={host} className={styles.host} data-dragging={resize.dragging || undefined}>
      <div className={styles.conversation} style={{ marginRight: docked ? width : 0 }}>{children}</div>
      {entry && <aside hidden={!visible} id={panelId} aria-label="文件更改详情" className={styles.drawer}
        style={{ width }} onKeyDown={(event) => { if (event.key === "Escape") { event.stopPropagation(); close(); } }}>
        {!expanded && <div className={styles.resizeHandle} role="separator" tabIndex={0}
          aria-label="调整详情抽屉宽度" aria-orientation="vertical" aria-controls={panelId}
          aria-valuemin={resize.minimum} aria-valuemax={resize.maximum} aria-valuenow={width} {...resize.handle} />}
        <header className={styles.header}>
          <span className={styles.tab}><FileDiff size={16} />{entry.title}</span>
          <div className={styles.controls}>
            <button aria-label={expanded ? "还原抽屉宽度" : "展开详情抽屉"} onClick={() => setExpanded(!expanded)}>
              {expanded ? <Minimize2 size={16} /> : <Maximize2 size={16} />}</button>
            <button aria-label="最小化详情抽屉" onClick={() => { setMinimized(true); opener.current?.focus(); }}>
              <Minus size={16} /></button>
            <button ref={closeButton} aria-label="关闭详情抽屉" onClick={close}><X size={17} /></button>
          </div>
        </header>
        <div key={`${entry.id}:${entry.filePath ?? ""}:${viewId}`} className={styles.content}>
          {!entry.files.length && <p className={styles.empty}>暂无文件更改</p>}
          <DiffDocument files={entry.files} filePath={entry.filePath}
            title={entry.title} status={entry.status}
            initialOpen continuous />
        </div>
      </aside>}
      {entry && minimized && active && <button className={styles.restore} onClick={() => setMinimized(false)}>
        <PanelRightOpen size={16} />恢复文件更改</button>}
    </div>
  </DetailsContext.Provider>;
}
