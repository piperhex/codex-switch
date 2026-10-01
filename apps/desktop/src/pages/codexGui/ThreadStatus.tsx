import { guiText } from "../../i18n/guiText";
import { CircleAlert, LoaderCircle } from "lucide-react";
import styles from "./ThreadStatus.module.less";

export function ThreadStatus({ running, unread, needsInput }: {
  running: boolean; unread: boolean; needsInput: boolean;
}) {
  let indicator = unread ? <span className={styles.dot} aria-label={guiText("未读回复")} /> : null;
  if (needsInput) indicator = <CircleAlert size={14} className={styles.attention} aria-label={guiText("等待确认")} />;
  if (running) indicator = <LoaderCircle size={14} className={styles.spinner} aria-label={guiText("正在回复")} />;
  return <span className={styles.status}>{indicator}</span>;
}
