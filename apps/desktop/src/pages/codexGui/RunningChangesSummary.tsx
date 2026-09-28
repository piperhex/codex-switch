import { useId, useMemo } from "react";
import { ChevronRight, FileText } from "lucide-react";
import { useDetailsEntry } from "./detailsContext";
import { useTurnChangedFiles } from "./useTurnChangedFiles";
import type { Conversation, Turn } from "./types";
import styles from "./RunningChangesSummary.module.less";

function TurnChangesBadge({ turn }: { turn: Turn }) {
  const id = useId();
  const files = useTurnChangedFiles(turn);
  const entry = useMemo(() => ({ id, title: "本轮修改", files }), [id, files]);
  const panel = useDetailsEntry(entry);
  if (!files.length) return null;
  const count = new Set(files.map((file) => file.path)).size;
  const added = files.reduce((sum, file) => sum + file.added, 0);
  const removed = files.reduce((sum, file) => sum + file.removed, 0);
  return <div className={styles.wrap}>
    <button type="button" className={styles.badge} onClick={() => panel?.open(entry)}
      aria-label={`查看本轮修改：已编辑 ${count} 个文件，新增 ${added} 行，删除 ${removed} 行`}>
      <FileText size={15} aria-hidden="true" />
      <span>已编辑 {count} 个文件</span>
      <span className={styles.counts}>
        <span className={styles.added}>+{added}</span><span className={styles.removed}>−{removed}</span>
      </span>
      <ChevronRight size={14} aria-hidden="true" />
    </button>
  </div>;
}

export function RunningChangesSummary({ value }: { value?: Conversation }) {
  const turn = value?.turns.find((entry) => entry.id === value.activeTurn);
  return turn ? <TurnChangesBadge key={`${value?.thread.id}:${turn.id}`} turn={turn} /> : null;
}
