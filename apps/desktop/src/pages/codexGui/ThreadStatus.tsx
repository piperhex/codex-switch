import { CircleAlert, LoaderCircle } from "lucide-react";
import styles from "./ThreadStatus.module.less";

export function ThreadStatus({ running, unread, needsInput }: {
  running: boolean; unread: boolean; needsInput: boolean;
}) {
  let indicator = unread ? <span className={styles.dot} aria-label="未读回复" /> : null;
  if (needsInput) indicator = <CircleAlert size={14} className={styles.attention} aria-label="等待确认" />;
  if (running) indicator = <LoaderCircle size={14} className={styles.spinner} aria-label="正在回复" />;
  return <span className={styles.status}>{indicator}</span>;
}
