import { useId, type ReactNode } from "react";
import { Tooltip } from "antd";
import { ChevronRight, Folder, Pin, SquarePen } from "lucide-react";
import type { Thread } from "./types";
import { previewThreads, THREAD_GROUP_PREVIEW_COUNT } from "../../../../../shared/chat/threadGroupPreview";
import styles from "./ThreadGroup.module.less";

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
  projectMenu?: ReactNode;
  projectPinned?: boolean;
  onToggle: (field: "collapsed" | "expanded") => void;
  renderThread: (thread: Thread) => ReactNode;
}

export function ThreadGroup({ label, pinned, threads, selected, collapsed, expanded, filtering,
  creatingDisabled, onNewConversation, projectMenu, projectPinned, onToggle, renderThread }: ThreadGroupProps) {
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
        {projectPinned && <Pin size={12} className={styles.pin} aria-label="已置顶" />}
      </button>
      {projectMenu}
      {onNewConversation && <Tooltip title="新建对话" overlayStyle={{ maxWidth: 400 }}>
        <button type="button" className={styles.add} aria-label={`在 ${label} 中新建对话`}
          disabled={creatingDisabled} onClick={onNewConversation}>
          <SquarePen size={14} strokeWidth={1.6} aria-hidden="true" />
        </button>
      </Tooltip>}
    </div>
    <div id={contentId} className={styles.content} hidden={isCollapsed}>
      {(showAll ? threads : previewThreads(threads, selected)).map(renderThread)}
      {threads.length > THREAD_GROUP_PREVIEW_COUNT && !filtering && <button type="button" className={styles.more}
        aria-expanded={showAll} aria-controls={contentId} onClick={() => onToggle("expanded")}>
        {showAll ? "收起" : "展开显示"}
      </button>}
    </div>
  </section>;
}
