import {
  Activity, Brain, ChevronDown, FilePenLine, Image, ListChecks, Search, Sparkles,
  SquareTerminal, Users, Wrench, Clock, FileSearch, type LucideIcon,
} from "lucide-react";
import type { Item } from "./types";
import { ToolDetails } from "./ToolDetails";
import { formatTurnDuration } from "./turnTiming";
import { DeferredDetails } from "./DeferredDetails";
import { collaborationSummary, isCollaborationActivity } from "./collaborationActivity";
import styles from "./ActivityRow.module.less";

const TOOL_ACTIVITIES: Record<string, { label: string; icon: LucideIcon }> = {
  fileChange: { label: "文件修改", icon: FilePenLine },
  mcpToolCall: { label: "调用工具", icon: Wrench },
  dynamicToolCall: { label: "调用工具", icon: Wrench },
  webSearch: { label: "搜索网页", icon: Search },
  contextCompaction: { label: "已整理对话上下文", icon: ListChecks },
  imageView: { label: "查看图片", icon: Image },
  imageGeneration: { label: "生成图片", icon: Sparkles },
  plan: { label: "计划", icon: ListChecks },
  sleep: { label: "等待", icon: Clock },
  enteredReviewMode: { label: "开始代码审查", icon: FileSearch },
  exitedReviewMode: { label: "代码审查结果", icon: FileSearch },
  functionCallOutput: { label: "工具输出", icon: Wrench },
  hookPrompt: { label: "任务补充", icon: ListChecks },
};
const DEFAULT_ACTIVITY = { label: "任务活动", icon: Activity };
const MAX_ACTIVITY_PREVIEW = 160;
const TOOL_STATUS_LABELS: Record<string, string> = {
  inProgress: "进行中", completed: "已完成", failed: "失败", declined: "已拒绝", interrupted: "已停止",
};

function commandLabel(status: Item["status"]) {
  if (status === "inProgress") return "正在运行";
  if (status === "completed") return "已运行";
  if (status === "failed") return "运行失败";
  if (status === "declined") return "已拒绝";
  return "执行命令";
}

function activitySummary(item: Item, text: string) {
  if (isCollaborationActivity(item)) return { icon: Users, preview: collaborationSummary(item) };
  if (item.type === "reasoning") return { icon: Brain,
    preview: text.slice(0, MAX_ACTIVITY_PREVIEW).trim().split("\n")[0].replace(/[*_`#]/g, "") };
  if (item.type === "commandExecution") {
    const action = item.commandActions?.find((entry) => entry.type !== "unknown");
    const labels: Record<string, string> = { read: "读取文件", listFiles: "浏览文件", search: "搜索代码" };
    const preview = action ? `${labels[action.type] || "执行命令"} · ${action.name || action.query || action.path || ""}`
      : `${commandLabel(item.status)} ${item.command ?? ""}`;
    return { icon: SquareTerminal, preview };
  }
  if (item.type === "sleep") return { icon: Clock,
    preview: `等待${item.durationMs != null ? ` · ${formatTurnDuration(item.durationMs)}` : ""}` };
  if (item.type === "webSearch" && item.action?.type === "openPage") {
    return { icon: Search, preview: `阅读网页 · ${item.action.url ?? item.query ?? ""}` };
  }
  const { label, icon } = TOOL_ACTIVITIES[item.type] ?? DEFAULT_ACTIVITY;
  const content = item.type === "fileChange"
    ? item.changes?.map((change) => change.path).join("、")
    : item.query || item.tool || item.review || item.text || item.path;
  const status = TOOL_STATUS_LABELS[item.status ?? ""];
  return { icon, preview: [label, content, status].filter(Boolean).join(" · ") };
}

export function ActivityRow({ item, text }: { item: Item; text: string }) {
  const reasoning = item.type === "reasoning";
  const summary = activitySummary(item, text);
  const Icon = summary.icon;
  const preview = summary.preview.slice(0, MAX_ACTIVITY_PREVIEW).replace(/\s+/g, " ").trim();
  return <DeferredDetails className={styles.row} status={item.status}
    summary={<summary className={styles.summary} aria-label={reasoning ? `思考过程：${preview}` : preview}>
      <Icon className={styles.icon} size={15} aria-hidden="true" />
      <span className={styles.preview}>{preview}</span>
      <ChevronDown className={styles.toggle} size={15} aria-hidden="true" />
    </summary>}>
    {() => <div className={reasoning ? styles.reasoningBody : styles.commandBody}>
      <ToolDetails item={item} text={text} /></div>}
  </DeferredDetails>;
}
