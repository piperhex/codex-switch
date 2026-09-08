import { Brain, ChevronDown, SquareTerminal } from "lucide-react";
import type { Item } from "./types";
import styles from "./ActivityRow.module.less";

function commandLabel(status: Item["status"]) {
  if (status === "inProgress") return "正在运行";
  if (status === "completed") return "已运行";
  if (status === "failed") return "运行失败";
  if (status === "declined") return "已拒绝";
  return "执行命令";
}

export function ActivityRow({ item, text }: { item: Item; text: string }) {
  const reasoning = item.type === "reasoning";
  const Icon = reasoning ? Brain : SquareTerminal;
  const preview = (reasoning ? text : `${commandLabel(item.status)} ${item.command ?? ""}`)
    .replace(/\s+/g, " ").trim();
  return <details className={styles.row}>
    <summary className={styles.summary} aria-label={reasoning ? `思考过程：${preview}` : preview}>
      <Icon className={styles.icon} size={15} aria-hidden="true" />
      <span className={styles.preview}>{preview}</span>
      <ChevronDown className={styles.toggle} size={15} aria-hidden="true" />
    </summary>
    <pre className={reasoning ? styles.reasoningBody : styles.commandBody}>{text}</pre>
  </details>;
}
