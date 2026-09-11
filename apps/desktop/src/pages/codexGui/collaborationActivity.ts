import type { Item } from "./types";

const ACTIVITY_LABELS: Record<string, string> = {
  started: "已启动协作任务", interacted: "协作消息", interrupted: "已停止协作任务", completed: "协作任务已完成",
};
const TOOL_LABELS: Record<string, string> = {
  spawnAgent: "启动协作任务", sendInput: "发送任务说明", resumeAgent: "继续协作任务",
  wait: "等待协作进展", closeAgent: "关闭协作任务", sendMessage: "发送协作消息",
  followupTask: "追加协作任务", interruptAgent: "停止协作任务", listAgents: "查看协作任务",
};
const STATUS_LABELS: Record<string, string> = {
  pendingInit: "准备中", running: "进行中", inProgress: "进行中", completed: "已完成",
  interrupted: "已停止", errored: "失败", failed: "失败", shutdown: "已关闭", notFound: "未找到任务",
};

export function isCollaborationActivity(item: Item): boolean {
  return ["subAgentActivity", "collabAgentToolCall", "collabToolCall"].includes(item.type);
}

export function collaborationTaskName(item: Item): string {
  return item.agentPath?.split("/").filter(Boolean).at(-1) || "协作任务";
}

export function collaborationStatus(status?: string): string {
  return STATUS_LABELS[status ?? ""] ?? "状态待更新";
}

export function collaborationSummary(item: Item): string {
  if (item.type === "subAgentActivity") {
    return `${ACTIVITY_LABELS[item.kind ?? ""] ?? "协作进度更新"} · ${collaborationTaskName(item)}`;
  }
  const label = TOOL_LABELS[item.tool ?? ""] ?? "协作任务";
  const count = new Set([...item.receiverThreadIds ?? [], ...Object.keys(item.agentsStates ?? {})]).size;
  const status = item.tool === "wait" && item.status === "completed"
    ? "本次等待结束" : item.status && collaborationStatus(item.status);
  return [label, count ? `${count} 个任务` : undefined, status].filter(Boolean).join(" · ");
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
