import { Fragment, memo, useMemo } from "react";
import type { Item, Turn } from "./types";
import { MessageItem } from "./MessageItem";
import { TurnDuration } from "./TurnDuration";
import { TurnPlan } from "./TurnPlan";
import { TurnDiff } from "./TurnDiff";
import { changedFiles, parseDiff } from "./diff";
import { visibleContinuationItems } from "./continuation";
import styles from "./styles.module.less";
import { GeneratedImages } from "./GeneratedImages";

interface Group { type: "work" | "message"; items: Item[] }

/** Only process messages collapse; user steering and final answers stay in chronological order. */
export function groupTurnItems(items: Item[]): Group[] {
  const lastAnswer = items.reduce((last, item, index) => item.type === "agentMessage" ? index : last, -1);
  return items.reduce<Group[]>((groups, item, index) => {
    const answer = item.type === "agentMessage"
      && (item.phase === "final_answer" || (!item.phase && index === lastAnswer));
    const type = item.type === "userMessage" || answer ? "message" : "work";
    if (type === "work" && groups.at(-1)?.type === "work") groups[groups.length - 1].items.push(item);
    else groups.push({ type, items: [item] });
    return groups;
  }, []);
}

export const TurnMessage = memo(function TurnMessage({ turn, running, active, followsInterruption = false,
  editableItemId, onEdit, editDisabled, threadId, visibleItems = turn.items }: {
  turn: Turn; running: boolean; active: boolean; followsInterruption?: boolean;
  editableItemId?: string; onEdit?: (text: string) => Promise<boolean>; editDisabled?: boolean;
  threadId?: string;
  visibleItems?: Item[];
}) {
  const groups = useMemo(() => {
    const visible = new Set(visibleItems.map((item) => item.id));
    return groupTurnItems(followsInterruption ? visibleContinuationItems(turn.items) : turn.items)
      .map((group) => ({ ...group, key: group.items[0].id, items: group.items.filter((item) => visible.has(item.id)) }))
      .filter((group) => group.items.length > 0);
  }, [turn.items, followsInterruption, visibleItems]);
  const netFiles = useMemo(() => parseDiff(turn.diff ?? ""), [turn.diff]);
  const files = useMemo(() => turn.diff ? netFiles : turn.items
    .filter((item) => item.type === "fileChange" && !["declined", "failed", "inProgress"].includes(item.status ?? ""))
    .flatMap((item) => changedFiles(item.changes ?? [])), [turn.diff, turn.items, netFiles]);
  const responseIndex = groups.findIndex((group) => group.items[0].type !== "userMessage");
  return <div className={styles.turn} data-turn-id={turn.id}>
    {groups.map((group, index) => <Fragment key={group.key}>
      {index === responseIndex && <TurnDuration turn={turn} running={running} active={active} />}
      {group.type === "work" ? <details className={styles.workGroup} open={running ? true : undefined}>
        <summary data-history-anchor>{running ? "正在处理" : "查看处理过程"}
          <span>{group.items.length} 项活动</span></summary>
        <div className={styles.workItems}>{group.items.map((item) => <div key={item.id} data-message-id={item.id}>
          <MessageItem item={item} startedAt={turn.startedAt} streaming={running && item.status !== "completed"} />
        </div>)}</div>
      </details> : <div className={styles.messageEntry} data-message-id={group.items[0].id}>
        <MessageItem item={group.items[0]} startedAt={turn.startedAt}
        onEdit={group.items[0].id === editableItemId ? onEdit : undefined} editDisabled={editDisabled}
        streaming={running && group.items[0].status !== "completed"} /></div>}
    </Fragment>)}
    {responseIndex === -1 && <TurnDuration turn={turn} running={running} active={active} />}
    <GeneratedImages items={visibleItems} />
    <TurnPlan turn={turn} />
    {files.length > 0 && <TurnDiff files={files} title={turn.diff ? "本轮修改" : "文件修改记录"}
      threadId={threadId} turnId={turn.id} disabled={running || turn.status === "inProgress" || Boolean(editDisabled)} />}
    {turn.status === "interrupted" && <p className={styles.muted}>已停止生成</p>}
    {turn.status === "failed" && <p className={styles.turnError} role="status">本次回复未完成，可以继续发送消息重试。</p>}
  </div>;
});
