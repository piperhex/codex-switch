import { Checkbox, Dropdown, Spin } from "antd";
import {
  ChevronDown, ChevronRight, Copy, FileJson, Folder, FolderOpen, MoreHorizontal, Search,
} from "lucide-react";
import type { Dispatch, SetStateAction } from "react";
import type { Language } from "../../../i18n";
import type { CodexThreadEntry, CodexThreadTokenTotals } from "../../../types";
import { openCodexThreadPath } from "../../../api/backend";
import type { ThreadCopy } from "../copy";
import type { ThreadGroup } from "../utils";
import {
  formatSize, formatTokenAmount, isUnassignedWorkspace, relativeTime, workspaceDisplayName,
} from "../utils";
import styles from "./index.module.less";

interface HighlightedTextProps {
  value: string;
  query: string;
}

function HighlightedText({ value, query }: HighlightedTextProps) {
  const normalizedQuery = query.trim();
  if (!normalizedQuery) return <>{value}</>;
  const escaped = normalizedQuery.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const parts = value.split(new RegExp(`(${escaped})`, "gi"));
  return <>{parts.map((part, index) => part.toLowerCase() === normalizedQuery.toLowerCase()
    ? <mark className={styles.threadSearchMark} key={`${part}-${index}`}>{part}</mark>
    : part)}</>;
}

interface SessionRowProps {
  thread: CodexThreadEntry;
  selected: boolean;
  stats?: CodexThreadTokenTotals;
  language: Language;
  text: ThreadCopy;
  query: string;
  toggle: () => void;
  notify: (message: string) => void;
  reportError: (error: unknown) => void;
  migrate: (id: string) => void;
}

function TokenStats({ stats, thread, text }: Pick<SessionRowProps, "stats" | "thread" | "text">) {
  return (
    <div className={styles.threadTokenStats}>
      {stats ? (
        <>
          <span>{text.inputTokens} {formatTokenAmount(stats.inputTokens)}</span>
          <span>{text.outputTokens} {formatTokenAmount(stats.outputTokens)}</span>
          <strong>{text.totalTokens} {formatTokenAmount(stats.totalTokens)}</strong>
        </>
      ) : <span>{formatSize(thread.sizeBytes)}</span>}
    </div>
  );
}

function SessionRow(props: SessionRowProps) {
  const { thread, selected, stats, language, text, query, toggle, notify, reportError, migrate } = props;
  const openPath = (key: string) => {
    if (key === "copy") {
      void navigator.clipboard.writeText(thread.sessionId).then(() => notify(text.copyId));
      return;
    }
    void openCodexThreadPath(thread.sessionId, key === "folder").catch(reportError);
  };
  return (
    <div className={styles.threadSessionRow}>
      <Checkbox checked={selected} onChange={toggle} />
      <FileJson size={18} />
      <div className={styles.threadSessionCopy}>
        <strong><HighlightedText value={thread.title || text.untitled} query={query} /></strong>
        <span>{thread.sessionId}</span>
        <span className={styles.threadAccount}>
          {text.account}: {thread.accountEmail || text.unknownAccount}
          {thread.accountActive && ` · ${text.currentAccount}`}
        </span>
        {thread.matchExcerpt && (
          <p className={styles.threadMatchExcerpt}>
            <Search size={12} />
            <span><HighlightedText value={thread.matchExcerpt} query={query} /></span>
          </p>
        )}
      </div>
      <TokenStats stats={stats} thread={thread} text={text} />
      <time>{relativeTime(thread.updatedAt, language)}</time>
      <Dropdown trigger={["click"]} menu={{
        items: [
          { key: "folder", icon: <FolderOpen size={15} />, label: text.openFolder },
          { key: "file", icon: <FileJson size={15} />, label: text.openFile },
          { key: "copy", icon: <Copy size={15} />, label: text.copyId },
          {
            key: "migrate",
            label: text.migrate,
            disabled: thread.accountActive,
          },
        ],
        onClick: ({ key }) => key === "migrate" ? migrate(thread.sessionId) : openPath(key),
      }}>
        <button className={styles.threadMore} aria-label="More"><MoreHorizontal size={17} /></button>
      </Dropdown>
    </div>
  );
}

interface WorkspaceGroupProps {
  group: ThreadGroup;
  isOpen: boolean;
  selected: Set<string>;
  tokens: Record<string, CodexThreadTokenTotals>;
  language: Language;
  text: ThreadCopy;
  query: string;
  toggleGroup: () => void;
  toggleThread: (id: string) => void;
  selectItems: (checked: boolean) => void;
  notify: (message: string) => void;
  reportError: (error: unknown) => void;
  migrate: (id: string) => void;
}

function WorkspaceGroup(props: WorkspaceGroupProps) {
  const { group, isOpen, selected, tokens, language, text, query } = props;
  const { toggleGroup, toggleThread, selectItems, notify, reportError, migrate } = props;
  const everySelected = group.items.every((item) => selected.has(item.sessionId));
  const someSelected = group.items.some((item) => selected.has(item.sessionId));
  const isUnassigned = isUnassignedWorkspace(group.cwd);
  return (
    <section className={styles.threadWorkspace}>
      <div className={styles.threadWorkspaceRow} onDoubleClick={toggleGroup}>
        <button className={styles.threadExpand} onClick={toggleGroup} aria-label={isOpen ? text.close : text.sessions}>
          {isOpen ? <ChevronDown size={17} /> : <ChevronRight size={17} />}
        </button>
        <Checkbox
          checked={everySelected}
          indeterminate={someSelected && !everySelected}
          onChange={(event) => selectItems(event.target.checked)}
        />
        <Folder size={20} />
        <div className={styles.threadWorkspaceCopy}>
          <strong>{workspaceDisplayName(group, text.untitled)}</strong>
          <span title={group.cwd}>{isUnassigned ? text.noProject : group.cwd}</span>
        </div>
        <span className={styles.threadWorkspaceCount}>{group.items.length} {text.sessions}</span>
        <time>{relativeTime(group.updatedAt, language)}</time>
      </div>
      {isOpen && (
        <div className={styles.threadSessionList}>
          {group.items.map((thread) => (
            <SessionRow
              key={thread.sessionId}
              thread={thread}
              selected={selected.has(thread.sessionId)}
              stats={tokens[thread.sessionId]}
              language={language}
              text={text}
              query={query}
              toggle={() => toggleThread(thread.sessionId)}
              notify={notify}
              reportError={reportError}
              migrate={migrate}
            />
          ))}
        </div>
      )}
    </section>
  );
}

interface ThreadListProps {
  language: Language;
  text: ThreadCopy;
  loading: boolean;
  appliedQuery: string;
  groups: ThreadGroup[];
  selected: Set<string>;
  setSelected: Dispatch<SetStateAction<Set<string>>>;
  expanded: Set<string>;
  tokens: Record<string, CodexThreadTokenTotals>;
  visibleCount: number;
  allVisibleSelected: boolean;
  someVisibleSelected: boolean;
  toggleAll: () => void;
  toggleThread: (id: string) => void;
  toggleGroup: (cwd: string, items: CodexThreadEntry[]) => Promise<void>;
  notify: (message: string) => void;
  reportError: (error: unknown) => void;
  migrate: (id: string) => void;
}

export function ThreadList(props: ThreadListProps) {
  const { language, text, loading, appliedQuery, groups, selected, setSelected } = props;
  const { expanded, tokens, visibleCount, allVisibleSelected, someVisibleSelected } = props;
  const { toggleAll, toggleThread, toggleGroup, notify, reportError, migrate } = props;
  const selectGroupItems = (items: CodexThreadEntry[], checked: boolean) => setSelected((current) => {
    const next = new Set(current);
    items.forEach((item) => checked ? next.add(item.sessionId) : next.delete(item.sessionId));
    return next;
  });
  let listContent = (
    <div className={styles.threadEmpty}>
      <FolderOpen size={30} /><span>{appliedQuery ? text.noMatch : text.empty}</span>
    </div>
  );
  if (loading) {
    listContent = <div className={styles.threadEmpty}><Spin /><span>{text.loading}</span></div>;
  } else if (groups.length) {
    listContent = <>{groups.map((group) => (
      <WorkspaceGroup
        key={group.cwd}
        group={group}
        isOpen={expanded.has(group.cwd)}
        selected={selected}
        tokens={tokens}
        language={language}
        text={text}
        query={appliedQuery}
        toggleGroup={() => void toggleGroup(group.cwd, group.items)}
        toggleThread={toggleThread}
        selectItems={(checked) => selectGroupItems(group.items, checked)}
        notify={notify}
        reportError={reportError}
        migrate={migrate}
      />
    ))}</>;
  }
  return (
    <div className={styles.codexThreadList}>
      <div className={styles.threadListHeader}>
        <span aria-hidden="true" />
        <Checkbox
          checked={allVisibleSelected}
          indeterminate={someVisibleSelected && !allVisibleSelected}
          disabled={!visibleCount}
          onChange={toggleAll}
          aria-label={text.selectAll}
        />
        <span aria-hidden="true" />
        <strong>{text.listTitle}</strong>
        <span className={styles.threadListHeaderCount}>{text.sessionCount}</span>
        <span className={styles.threadListHeaderTime}>{text.conversationTime}</span>
      </div>
      <div className={styles.threadListScroll}>{listContent}</div>
    </div>
  );
}
