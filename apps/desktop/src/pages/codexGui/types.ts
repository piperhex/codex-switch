import type { ThreadGoal } from "./goalTypes";
import type { AttachmentReference } from "./attachmentTypes";

export type AccessMode = "read-only" | "workspace-write" | "danger-full-access";
export interface SkillReference { name: string; path: string }
export interface Skill extends SkillReference {
  description: string;
  shortDescription?: string;
  iconUrl?: string;
  interface?: { displayName?: string; shortDescription?: string;
    iconSmallUrl?: string | null; iconLargeUrl?: string | null };
  enabled: boolean;
}
export interface SkillMention { start: number; end: number; skill: Skill }
export interface ComposerText { text: string; mentions: SkillMention[] }
export interface SkillsResponse { data: { skills: Skill[]; errors: { message: string }[] }[] }
export interface Model {
  id: string;
  model: string;
  displayName: string;
  isDefault: boolean;
  defaultReasoningEffort: string;
  supportedReasoningEfforts: { reasoningEffort: string; description: string }[];
}
export interface Content { type: string; text?: string; name?: string; path?: string; url?: string }
export interface FileChange { path: string; diff: string; kind: { type: string; movePath?: string | null } }
export interface PlanStep { step: string; status: string }
export interface SearchResult { title?: string; url?: string; snippet?: string }
export interface Item {
  id: string;
  type: string;
  text?: string;
  content?: Content[] | string[];
  summary?: string[];
  command?: string;
  commandActions?: { type: string; name?: string; path?: string | null; query?: string | null }[];
  cwd?: string;
  status?: string;
  aggregatedOutput?: string;
  exitCode?: number | null;
  changes?: FileChange[];
  phase?: "commentary" | "final_answer" | null;
  durationMs?: number | null;
  path?: string;
  imageUrl?: string;
  revisedPrompt?: string;
  savedPath?: string;
  failure?: { message?: string } | null;
  contentItems?: unknown[];
  success?: boolean;
  progress?: string[];
  action?: { type: string; query?: string; queries?: string[]; url?: string; pattern?: string };
  results?: SearchResult[];
  prompt?: string;
  receiverThreadIds?: string[];
  agentsStates?: Record<string, { status?: string; message?: string | null }>;
  agentStatus?: unknown;
  review?: string;
  name?: string;
  output?: unknown;
  tool?: string;
  server?: string;
  query?: string;
  arguments?: unknown;
  result?: unknown;
  error?: unknown;
}
export interface Turn {
  id: string; status: string; items: Item[]; startedAt?: number | null; error?: { message: string } | null;
  completedAt?: number | null;
  durationMs?: number | null;
  diff?: string;
  plan?: PlanStep[];
  planExplanation?: string | null;
}
export interface Thread {
  id: string;
  name?: string | null;
  preview: string;
  cwd: string;
  updatedAt: number;
  status?: { type: string };
  turns?: Turn[];
}
export interface Question {
  id: string;
  header: string;
  question: string;
  isSecret?: boolean;
  options?: { label: string; description: string }[];
}
export interface ThreadTokenUsage {
  total: { totalTokens: number };
  last: { totalTokens: number };
  modelContextWindow?: number | null;
}
export interface EventParams {
  goal?: ThreadGoal;
  threadId?: string;
  thread?: Thread;
  turnId?: string;
  turn?: Turn;
  itemId?: string;
  item?: Item;
  delta?: string;
  message?: string;
  explanation?: string | null;
  summaryIndex?: number;
  contentIndex?: number;
  requestId?: string | number;
  reason?: string;
  command?: string;
  cwd?: string;
  grantRoot?: string;
  permissions?: {
    network?: { enabled?: boolean };
    fileSystem?: { read?: string[]; write?: string[]; entries?: unknown[] };
  };
  availableDecisions?: unknown[];
  questions?: Question[];
  diff?: string;
  plan?: PlanStep[];
  tokenUsage?: ThreadTokenUsage;
  error?: { message: string };
  willRetry?: boolean;
}
export interface GuiEvent { method: string; params: EventParams; id?: string | number | null }
export interface Conversation {
  thread: Thread;
  turns: Turn[];
  activeTurn: string | null;
  tokens: number;
  tokenUsage?: ThreadTokenUsage;
  error: string;
}
export interface ListResponse<T> { data: T[]; nextCursor: string | null }
export interface Settings { cwd: string; model: string; effort: string; access: AccessMode }
export interface GuiState {
  goals?: Record<string, ThreadGoal | null>;
  goalErrors?: Record<string, string>;
  goalBusy?: boolean;
  queued: Record<string, QueuedMessage[]>;
  connection: "offline" | "connecting" | "ready";
  threads: Thread[];
  conversations: Record<string, Conversation>;
  selected: string | null;
  models: Model[];
  approvals: GuiEvent[];
  settings: Settings;
  loading: boolean;
  sending: boolean;
  deleting?: string;
  compacting?: string;
  archived: boolean;
  search: string;
  cursor: string | null;
  error: string;
  pins: string[];
  projects: string[];
  projectOverrides: Record<string, string>;
}
export type ApprovalReply = {
  id: string | number;
  decision?: "accept" | "decline" | "cancel";
  answers?: Record<string, { answers: string[] }>;
};
export type Request =
  | { operation: "goalGet" | "goalClear"; threadId: string }
  | { operation: "goalSet"; threadId: string; objective?: string; status: "active" | "paused" }
  | { operation: "plugins"; cwd?: string }
  | { operation: "sendBatch"; threadId: string; messages: MessageInput[]; model?: string; effort?: string }
  | { operation: "steer"; threadId: string; turnId: string; text: string; images: string[];
      skills: SkillReference[]; attachments?: AttachmentReference[] }
  | { operation: "skills"; cwd?: string }
  | { operation: "models"; cursor?: string }
  | { operation: "list"; cursor?: string; archived: boolean; search?: string }
  | { operation: "start"; cwd?: string; model?: string; access: AccessMode }
  | { operation: "resume"; threadId: string; access: AccessMode; cwd?: string }
  | { operation: "send"; threadId: string; text: string; images: string[];
      model?: string; effort?: string; cwd?: string; skills?: SkillReference[]; attachments?: AttachmentReference[] }
  | { operation: "read" | "archive" | "unarchive" | "compact"; threadId: string }
  | { operation: "rename"; threadId: string; name: string }
  | { operation: "interrupt"; threadId: string; turnId: string };

export interface MessageInput {
  text: string; images: string[]; skills: SkillReference[]; attachments?: AttachmentReference[];
}
export interface QueuedMessage extends MessageInput {
  id: string;
  editing?: boolean;
  busy?: boolean;
  model: string;
  effort: string;
  access: AccessMode;
}
