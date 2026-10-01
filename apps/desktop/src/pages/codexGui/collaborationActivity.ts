import { guiText } from "../../i18n/guiText";
import type { Item } from "./types";

const ACTIVITY_LABELS: Record<string, string> = {
  get started() { return guiText("已启动协作任务"); }, get interacted() { return guiText("协作消息"); }, get interrupted() { return guiText("已停止协作任务"); }, get completed() { return guiText("协作任务已完成"); },
};
const TOOL_LABELS: Record<string, string> = {
  get spawnAgent() { return guiText("启动协作任务"); }, get sendInput() { return guiText("发送任务说明"); }, get resumeAgent() { return guiText("继续协作任务"); },
  get wait() { return guiText("等待协作进展"); }, get closeAgent() { return guiText("关闭协作任务"); }, get sendMessage() { return guiText("发送协作消息"); },
  get followupTask() { return guiText("追加协作任务"); }, get interruptAgent() { return guiText("停止协作任务"); }, get listAgents() { return guiText("查看协作任务"); },
};
const STATUS_LABELS: Record<string, string> = {
  get pendingInit() { return guiText("准备中"); }, get running() { return guiText("进行中"); }, get inProgress() { return guiText("进行中"); }, get completed() { return guiText("已完成"); },
  get interrupted() { return guiText("已停止"); }, get errored() { return guiText("失败"); }, get failed() { return guiText("失败"); }, get shutdown() { return guiText("已关闭"); }, get notFound() { return guiText("未找到任务"); },
};

export function isCollaborationActivity(item: Item): boolean {
  return ["subAgentActivity", "collabAgentToolCall", "collabToolCall"].includes(item.type);
}

export function collaborationTaskName(item: Item): string {
  return item.agentPath?.split("/").filter(Boolean).at(-1) || guiText("协作任务");
}

export function collaborationStatus(status?: string): string {
  return STATUS_LABELS[status ?? ""] ?? guiText("状态待更新");
}

export function collaborationSummary(item: Item, translate = (text: string) => text): string {
  if (item.type === "subAgentActivity") {
    const label = translate(ACTIVITY_LABELS[item.kind ?? ""] ?? guiText("协作进度更新"));
    return guiText("{value1} · {value2}", { value1: label, value2: item.agentPath ? collaborationTaskName(item) : translate("协作任务") });
  }
  const label = TOOL_LABELS[item.tool ?? ""] ?? guiText("协作任务");
  const count = new Set([...item.receiverThreadIds ?? [], ...Object.keys(item.agentsStates ?? {})]).size;
  const status = item.tool === "wait" && item.status === "completed"
    ? guiText("本次等待结束") : item.status && collaborationStatus(item.status);
  return [translate(label), count ? guiText("{value1} {value2}", { value1: count, value2: translate("个任务") }) : undefined, status && translate(status)]
    .filter(Boolean).join(" · ");
}

/** Older collaboration items carry one agentStatus instead of an agentsStates map. */
export function collaborationStates(item: Item): { status?: string; message?: string | null }[] {
  const states = Object.values(item.agentsStates ?? {});
  if (states.length || item.agentStatus == null) return states;
  if (typeof item.agentStatus === "string") return [{ status: item.agentStatus }];
  if (typeof item.agentStatus !== "object" || Array.isArray(item.agentStatus)) return [];
  const state = item.agentStatus as Record<string, unknown>;
  return [{ status: typeof state.status === "string" ? state.status : undefined,
    message: typeof state.message === "string" ? state.message : undefined }];
}
