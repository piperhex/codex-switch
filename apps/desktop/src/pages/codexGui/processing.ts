import type { Conversation, GuiEvent, Item, Turn } from "./types";
import { SECOND_MS } from "./turnTiming";

export const PROCESSING_LABELS = {
  sending: "正在发送请求", request: "等待响应", reasoning: "正在思考", response: "正在生成回复",
  command: "正在执行命令", files: "正在修改文件", tool: "正在调用工具", search: "正在搜索网页",
  image: "正在生成图片", collaboration: "正在等待协作任务", compact: "正在整理上下文",
  approval: "等待你的确认", input: "等待你的补充", retry: "正在重试", wait: "正在等待",
  processing: "Codex 正在处理",
};
export type ProcessingPhase = keyof typeof PROCESSING_LABELS;
interface Activity { id: string; phase: ProcessingPhase }
export interface ProcessingState extends Activity {
  turnId: string;
  startedAtMs: number;
  activities: Activity[];
  completedIds: string[];
}
export interface PendingRequest { threadId: string | null; startedAtMs: number }

const ITEM_PHASES: Record<string, ProcessingPhase> = {
  reasoning: "reasoning", agentMessage: "response", plan: "reasoning", commandExecution: "command",
  fileChange: "files", mcpToolCall: "tool", dynamicToolCall: "tool", webSearch: "search",
  imageGeneration: "image", imageView: "tool", contextCompaction: "compact", sleep: "wait",
  collabAgentToolCall: "collaboration", collabToolCall: "collaboration", subAgentActivity: "collaboration",
};
const FINISHED = new Set(["completed", "failed", "declined", "interrupted"]);
const WAITING: Activity = { id: "request", phase: "request" };

function currentActivity(activities: Activity[]): Activity {
  return [...activities].reverse().find((item) => item.phase === "approval" || item.phase === "input")
    ?? activities.at(-1) ?? WAITING;
}

function selectActivity(state: ProcessingState, activities: Activity[]): ProcessingState {
  const next = currentActivity(activities);
  const unchanged = state.id === next.id && state.phase === next.phase;
  return { ...state, ...next, activities, startedAtMs: unchanged ? state.startedAtMs : Date.now() };
}

/** Preserve observed phase timing across view switches; history has no per-item start timestamps. */
export function restoreProcessing(turn: Turn, previous?: ProcessingState): ProcessingState {
  if (previous?.turnId === turn.id) return previous;
  const activities = turn.items.filter((item) => item.status === "inProgress" && item.type !== "userMessage")
    .map((item) => ({ id: item.id, phase: ITEM_PHASES[item.type] ?? "processing" }));
  const current = currentActivity(activities);
  const hasActivity = turn.items.some((item) => item.type !== "userMessage");
  return { ...current, turnId: turn.id, activities,
    completedIds: turn.items.filter((item) => FINISHED.has(item.status ?? "")).map((item) => item.id),
    startedAtMs: hasActivity ? Date.now() : (turn.startedAt ?? Date.now() / SECOND_MS) * SECOND_MS };
}

function updateActivity(state: ProcessingState, item: Item, completed: boolean): ProcessingState {
  if (item.type === "userMessage") return state;
  if (state.completedIds.includes(item.id)) return state;
  const existing = state.activities.find((entry) => entry.id === item.id);
  const activities = state.activities.filter((entry) => entry.id !== item.id);
  if (completed) return { ...(existing ? selectActivity(state, activities) : state),
    completedIds: [...state.completedIds, item.id] };
  // Streaming chunks update content, not the start time or priority of an already running activity.
  if (existing) return state;
  return selectActivity(state, [...activities, { id: item.id, phase: ITEM_PHASES[item.type] ?? "processing" }]);
}

export function trackProcessing(value: Conversation, event: GuiEvent): Conversation {
  const turn = value.turns.find((entry) => entry.id === value.activeTurn);
  if (!turn) return value.processing ? { ...value, processing: undefined } : value;
  const state = restoreProcessing(turn, value.processing);
  if (event.params.turnId && event.params.turnId !== turn.id) return value;
  const { method, params } = event;
  let processing = state;
  if (method === "error" && params.willRetry) {
    processing = { ...state, id: "retry", phase: "retry", activities: [],
      startedAtMs: state.phase === "retry" ? state.startedAtMs : Date.now() };
  } else if (method.startsWith("item/")) {
    const item = params.item ?? turn.items.find((entry) => entry.id === params.itemId);
    if (item) processing = updateActivity(state, item, method === "item/completed" || FINISHED.has(item.status ?? ""));
  }
  return processing === value.processing ? value : { ...value, processing };
}

export function processingApproval(state: ProcessingState, event: GuiEvent, resolved = false): ProcessingState {
  const id = `approval:${event.id}`;
  const activities = state.activities.filter((entry) => entry.id !== id);
  if (resolved) return selectActivity(state, activities);
  if (activities.length !== state.activities.length) return state;
  const phase = event.method === "item/tool/requestUserInput" ? "input" : "approval";
  return selectActivity(state, [...activities, { id, phase }]);
}
