import { guiText } from "../../i18n/guiText";
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
import { commandPreview } from "./commandPreview";

const TOOL_ACTIVITIES: Record<string, { label: string; icon: LucideIcon }> = {
  fileChange: { get label() { return guiText("文件修改"); }, icon: FilePenLine },
  mcpToolCall: { get label() { return guiText("调用工具"); }, icon: Wrench },
  dynamicToolCall: { get label() { return guiText("调用工具"); }, icon: Wrench },
  webSearch: { get label() { return guiText("搜索网页"); }, icon: Search },
  contextCompaction: { get label() { return guiText("已整理对话上下文"); }, icon: ListChecks },
  imageView: { get label() { return guiText("查看图片"); }, icon: Image },
  imageGeneration: { get label() { return guiText("生成图片"); }, icon: Sparkles },
  plan: { get label() { return guiText("计划"); }, icon: ListChecks },
  sleep: { get label() { return guiText("等待"); }, icon: Clock },
  enteredReviewMode: { get label() { return guiText("开始代码审查"); }, icon: FileSearch },
  exitedReviewMode: { get label() { return guiText("代码审查结果"); }, icon: FileSearch },
  functionCallOutput: { get label() { return guiText("工具输出"); }, icon: Wrench },
  hookPrompt: { get label() { return guiText("任务补充"); }, icon: ListChecks },
};
const DEFAULT_ACTIVITY = { get label() { return guiText("任务活动"); }, icon: Activity };
const MAX_ACTIVITY_PREVIEW = 160;
const TOOL_STATUS_LABELS: Record<string, string> = {
  get inProgress() { return guiText("进行中"); }, get completed() { return guiText("已完成"); }, get failed() { return guiText("失败"); }, get declined() { return guiText("已拒绝"); }, get interrupted() { return guiText("已停止"); },
};

function commandLabel(status: Item["status"]) {
  if (status === "inProgress") return guiText("正在运行");
  if (status === "completed") return guiText("已运行");
  if (status === "failed") return guiText("运行失败");
  if (status === "declined") return guiText("已拒绝");
  if (status === "interrupted") return guiText("已停止");
  return guiText("执行命令");
}

function activitySummary(item: Item, text: string) {
  if (isCollaborationActivity(item)) return { icon: Users, preview: collaborationSummary(item) };
  if (item.type === "reasoning") return { icon: Brain,
    preview: text.slice(0, MAX_ACTIVITY_PREVIEW).trim().split("\n")[0].replace(/[*_`#]/g, "") };
  if (item.type === "commandExecution") {
    const action = item.commandActions?.find((entry) => entry.type !== "unknown");
    const labels: Record<string, string> = { read: guiText("读取文件"), listFiles: guiText("浏览文件"), search: guiText("搜索代码") };
    const preview = action ? guiText("{value1} · {value2}", { value1: labels[action.type] || "执行命令", value2: action.name || action.query || action.path || "" })
      : `${commandLabel(item.status)} ${commandPreview(item.command ?? "")}`;
    return { icon: SquareTerminal, preview };
  }
  if (item.type === "sleep") return { icon: Clock,
    preview: guiText("等待{value1}", { value1: item.durationMs != null ? ` · ${formatTurnDuration(item.durationMs)}` : "" }) };
  if (item.type === "webSearch" && item.action?.type === "openPage") {
    return { icon: Search, preview: guiText("阅读网页 · {value1}", { value1: item.action.url ?? item.query ?? "" }) };
  }
  const { label, icon } = TOOL_ACTIVITIES[item.type] ?? DEFAULT_ACTIVITY;
  const content = item.type === "fileChange"
    ? item.changes?.map((change) => change.path).join("、")
    : item.query || item.tool || item.review || item.text || item.path;
  const status = TOOL_STATUS_LABELS[item.status ?? ""];
  return { icon, preview: [label, content, status].filter(Boolean).join(" · ") };
}

export function ActivitySummary({ item, text, count }: { item: Item; text: string; count?: number }) {
  const reasoning = item.type === "reasoning";
  const summary = activitySummary(item, text);
  const Icon = summary.icon;
  const preview = summary.preview.slice(0, MAX_ACTIVITY_PREVIEW).replace(/\s+/g, " ").trim();
  const label = reasoning ? guiText("思考过程：{value1}", { value1: preview }) : preview;
  return <summary className={styles.summary} aria-label={count ? guiText("{value1}，查看全部 {value2} 项活动", { value1: label, value2: count }) : label}>
      <Icon className={styles.icon} size={15} aria-hidden="true" />
      <span className={styles.preview}>{preview}</span>
      <ChevronDown className={styles.toggle} size={15} aria-hidden="true" />
    </summary>;
}

export function ActivityRow({ item, text }: { item: Item; text: string }) {
  const reasoning = item.type === "reasoning";
  return <DeferredDetails className={styles.row} status={item.status}
    summary={<ActivitySummary item={item} text={text} />}>
    {() => <div className={reasoning ? styles.reasoningBody : styles.commandBody}>
      <ToolDetails item={item} text={text} /></div>}
  </DeferredDetails>;
}
