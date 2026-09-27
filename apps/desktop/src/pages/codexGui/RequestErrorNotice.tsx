import type { Turn } from "./types";
import { requestErrorDetails } from "./requestError";
import { DeferredDetails } from "./DeferredDetails";
import { requestErrorPosition, type TurnRequestError } from "./turnRequestErrors";
import styles from "./RequestErrorNotice.module.less";

function noticeMessage(turn: Turn, record: TurnRequestError): string {
  if (!record.willRetry) return "本次回复遇到问题，可以继续发送消息重试。";
  if (turn.status === "completed") return "本次回复曾出现连接中断，现已恢复。";
  if (turn.status === "interrupted" || turn.status === "failed") return "本次回复曾出现连接中断。";
  const resumed = turn.items.slice(requestErrorPosition(turn, record))
    .some((item) => item.type !== "userMessage" && item.type !== "modelChange");
  if (resumed) return "本次回复曾出现连接中断，现已恢复。";
  return "连接暂时中断，Codex 正在重试…";
}

export function RequestErrorNotice({ turn, record }: { turn: Turn; record: TurnRequestError }) {
  const { error } = record;
  const details = error ? requestErrorDetails(error) : "";
  const message = noticeMessage(turn, record);
  if (!details) return <p className={styles.notice} role="status">{message}</p>;
  return <DeferredDetails className={styles.notice} summary={<summary>
    <span role="status">{message}</span><span className={styles.hint}>查看报错详情</span>
  </summary>}>
    {() => <pre className={styles.details}>{details}</pre>}
  </DeferredDetails>;
}
