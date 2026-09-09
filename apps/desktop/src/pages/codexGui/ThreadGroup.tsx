import { useId, type ReactNode } from "react";
import { Tooltip } from "antd";
import { ChevronRight, Folder, Pin, SquarePen } from "lucide-react";
import type { Thread } from "./types";
import styles from "./ThreadGroup.module.less";

const PREVIEW_COUNT = 5;
interface ThreadGroupProps {
  label: string;
  pinned: boolean;
  threads: Thread[];
  selected: string | null;
  collapsed: boolean;
  expanded: boolean;
  filtering: boolean;
  creatingDisabled: boolean;
  onNewConversation?: () => void;
  onToggle: (field: "collapsed" | "expanded") => void;
  renderThread: (thread: Thread) => ReactNode;
}

function previewThreads(threads: Thread[], selected: string | null) {
  const preview = threads.slice(0, PREVIEW_COUNT);
  const active = threads.find((thread) => thread.id === selected);
  if (!active || preview.includes(active)) return preview;
  // Keep the current conversation reachable when the older rows are folded away.
  return [...preview.slice(0, PREVIEW_COUNT - 1), active];
}

export function ThreadGroup({ label, pinned, threads, selected, collapsed, expanded, filtering,
  creatingDisabled, onNewConversation, onToggle, renderThread }: ThreadGroupProps) {
  const contentId = useId();
  const isCollapsed = collapsed && !filtering;
  const showAll = expanded || filtering;
  const Icon = pinned ? Pin : Folder;
  return <section className={styles.group} aria-label={label}>
    <div className={styles.header}>
      <button type="button" className={styles.heading} aria-expanded={!isCollapsed} aria-controls={contentId}
        disabled={filtering} onClick={() => onToggle("collapsed")}>
        <span className={styles.icon} aria-hidden="true">
          <Icon size={14} className={styles.folder} />
          <ChevronRight size={14} className={styles.arrow} />
        </span>
        <span className={styles.label}>{label}</span>
      </button>
      {onNewConversation && <Tooltip title="新建对话" overlayStyle={{ maxWidth: 400 }}>
        <button type="button" className={styles.add} aria-label={`在 ${label} 中新建对话`}
          disabled={creatingDisabled} onClick={onNewConversation}>
          <SquarePen size={16} strokeWidth={1.6} aria-hidden="true" />
        </button>
      </Tooltip>}
    </div>
    <div id={contentId} className={styles.content} hidden={isCollapsed}>
      {(showAll ? threads : previewThreads(threads, selected)).map(renderThread)}
      {threads.length > PREVIEW_COUNT && !filtering && <button type="button" className={styles.more}
        aria-expanded={showAll} aria-controls={contentId} onClick={() => onToggle("expanded")}>
        {showAll ? "收起" : "展开显示"}
      </button>}
    </div>
  </section>;
}
