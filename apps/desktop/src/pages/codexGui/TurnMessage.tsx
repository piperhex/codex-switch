import { guiText } from "../../i18n/guiText";
import { useGuiLanguage } from '../../i18n/useGuiLanguage';
import { Fragment, memo, useMemo } from "react";
import type { Item, Turn } from "./types";
import type { SubmitMessageEdit } from "./messageEditContent";
import { MessageItem } from "./MessageItem";
import { TurnDuration } from "./TurnDuration";
import { TurnPlan } from "./TurnPlan";
import { TurnDiff } from "./TurnDiff";
import { useTurnChangedFiles } from "./useTurnChangedFiles";
import styles from "./styles.module.less";
import { GeneratedImages } from "./GeneratedImages";
import { RequestErrorNotice } from "./RequestErrorNotice";
import type { CapacityRetryControl } from "./CapacityErrorNotice";
import { turnRequestErrors } from "./turnRequestErrors";
import { isModelCapacityError } from "./requestError";
import { TurnProcess } from "./TurnProcess";
import { turnMessageGroups } from "./turnMessageGroups";
export { groupTurnItems } from "../../../../../shared/chat/turnGroups";

export const TurnMessage = memo(function TurnMessage({ turn, running, active, followsInterruption = false,
  editableItemId, onEdit, editDisabled, threadId, visibleItems = turn.items, onFork, forkDisabled,
  retry, onCancelRetry }: {
  turn: Turn; running: boolean; active: boolean; followsInterruption?: boolean;
  editableItemId?: string; onEdit?: SubmitMessageEdit; editDisabled?: boolean;
  threadId?: string;
  visibleItems?: Item[];
  onFork?: () => void; forkDisabled?: boolean;
} & CapacityRetryControl) {
  useGuiLanguage();
  const groups = useMemo(() => turnMessageGroups(turn, { visibleItems, followsInterruption }),
    [turn, followsInterruption, visibleItems]);
  const files = useTurnChangedFiles(turn);
  const showChanges = !running && turn.status !== "inProgress" && files.length > 0;
  const responseIndex = groups.findIndex((group) => group.type !== "error" && group.items[0].type !== "userMessage");
  return <div className={styles.turn} data-turn-id={turn.id}>
    {groups.map((group, index) => group.type === "error"
      ? <RequestErrorNotice key={group.key} turn={turn} record={group.error}
        retry={group.error.id === turnRequestErrors(turn).at(-1)?.id ? retry : undefined}
        onCancelRetry={onCancelRetry} />
      : <Fragment key={group.key}>
      {index === responseIndex && group.type !== "work"
        && <TurnDuration turn={turn} running={running} active={active} />}
      {group.type === "work" ? <TurnProcess turn={turn} items={group.items} running={running}
        active={active} timed={index === responseIndex} />
        : <div className={styles.messageEntry} data-message-id={group.items[0].id}>
        <MessageItem item={group.items[0]} startedAt={turn.startedAt}
        completedAt={turn.completedAt} onFork={onFork}
        forkDisabled={forkDisabled || running || turn.status === "inProgress"}
        onEdit={group.items[0].id === editableItemId ? onEdit : undefined} editDisabled={editDisabled}
        streaming={running && group.items[0].status !== "completed"} /></div>}
    </Fragment>)}
    {responseIndex === -1 && !running && !isModelCapacityError(turn.error)
      && <TurnDuration turn={turn} running={running} active={active} />}
    <GeneratedImages items={visibleItems} />
    <TurnPlan turn={turn} />
    {showChanges && <TurnDiff files={files} title={turn.diff ? guiText("本轮修改") : guiText("文件修改记录")}
      threadId={threadId} turnId={turn.id}
      disabled={running || turn.status === "inProgress" || Boolean(editDisabled)} />}
  </div>;
});
