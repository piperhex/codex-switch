import {
  Activity, Brain, ChevronDown, FilePenLine, Image, ListChecks, Search, Sparkles,
  SquareTerminal, Users, Wrench, type LucideIcon,
} from "lucide-react";
import type { Item } from "./types";
import styles from "./ActivityRow.module.less";

const TOOL_ACTIVITIES: Record<string, { label: string; icon: LucideIcon }> = {
  fileChange: { label: "文件修改", icon: FilePenLine },
  mcpToolCall: { label: "调用工具", icon: Wrench },
  dynamicToolCall: { label: "调用工具", icon: Wrench },
  collabAgentToolCall: { label: "协作任务", icon: Users },
  webSearch: { label: "搜索网页", icon: Search },
  contextCompaction: { label: "已整理对话上下文", icon: ListChecks },
  imageView: { label: "查看图片", icon: Image },
  imageGeneration: { label: "生成图片", icon: Sparkles },
  plan: { label: "计划", icon: ListChecks },
};
const DEFAULT_ACTIVITY = { label: "任务活动", icon: Activity };
const TOOL_STATUS_LABELS: Record<string, string> = {
  inProgress: "进行中", failed: "失败", declined: "已拒绝",
};

function commandLabel(status: Item["status"]) {
  if (status === "inProgress") return "正在运行";
  if (status === "completed") return "已运行";
  if (status === "failed") return "运行失败";
  if (status === "declined") return "已拒绝";
  return "执行命令";
}

function activitySummary(item: Item, text: string) {
  if (item.type === "reasoning") return { icon: Brain, preview: text };
  if (item.type === "commandExecution") {
    return { icon: SquareTerminal, preview: `${commandLabel(item.status)} ${item.command ?? ""}` };
  }
  const { label, icon } = TOOL_ACTIVITIES[item.type] ?? DEFAULT_ACTIVITY;
  const content = item.type === "fileChange"
    ? item.changes?.map((change) => change.path).join("、")
    : item.query || item.tool || item.text;
  const status = TOOL_STATUS_LABELS[item.status ?? ""];
  return { icon, preview: [label, content, status].filter(Boolean).join(" · ") };
}

export function ActivityRow({ item, text }: { item: Item; text: string }) {
  const reasoning = item.type === "reasoning";
  const summary = activitySummary(item, text);
  const Icon = summary.icon;
  const preview = summary.preview.replace(/\s+/g, " ").trim();
  return <details className={styles.row}>
    <summary className={styles.summary} aria-label={reasoning ? `思考过程：${preview}` : preview}>
      <Icon className={styles.icon} size={15} aria-hidden="true" />
      <span className={styles.preview}>{preview}</span>
      <ChevronDown className={styles.toggle} size={15} aria-hidden="true" />
    </summary>
    <pre className={reasoning ? styles.reasoningBody : styles.commandBody}>{text}</pre>
  </details>;
}
