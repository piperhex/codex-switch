export type AccessMode = "read-only" | "workspace-write" | "danger-full-access";
export interface Model {
  id: string;
  model: string;
  displayName: string;
  isDefault: boolean;
  defaultReasoningEffort: string;
  supportedReasoningEfforts: { reasoningEffort: string; description: string }[];
}
export interface Content { type: string; text?: string; path?: string; url?: string }
export interface Item {
  id: string;
  type: string;
  text?: string;
  content?: Content[] | string[];
  summary?: string[];
  command?: string;
  cwd?: string;
  status?: string;
  aggregatedOutput?: string;
  exitCode?: number | null;
  changes?: { path: string; diff: string; kind: { type: string } }[];
  tool?: string;
  server?: string;
  query?: string;
  arguments?: unknown;
  result?: unknown;
  error?: unknown;
}
export interface Turn { id: string; status: string; items: Item[]; error?: { message: string } | null }
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
export interface EventParams {
  threadId?: string;
  thread?: Thread;
  turnId?: string;
  turn?: Turn;
  itemId?: string;
  item?: Item;
  delta?: string;
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
  plan?: { step: string; status: string }[];
  tokenUsage?: { total: { totalTokens: number }; last: { totalTokens: number }; modelContextWindow?: number };
  error?: { message: string };
  willRetry?: boolean;
}
export interface GuiEvent { method: string; params: EventParams; id?: string | number | null }
export interface Conversation {
  thread: Thread;
  turns: Turn[];
  activeTurn: string | null;
  diff: string;
  plan: { step: string; status: string }[];
  tokens: number;
  error: string;
}
export interface ListResponse<T> { data: T[]; nextCursor: string | null }
export interface Settings { cwd: string; model: string; effort: string; access: AccessMode }
export interface GuiState {
  connection: "offline" | "connecting" | "ready";
  threads: Thread[];
  conversations: Record<string, Conversation>;
  selected: string | null;
  models: Model[];
  approvals: GuiEvent[];
  settings: Settings;
  loading: boolean;
  sending: boolean;
  archived: boolean;
  search: string;
  cursor: string | null;
  error: string;
  pins: string[];
  projects: string[];
}
export type ApprovalReply = {
  id: string | number;
  decision?: "accept" | "decline" | "cancel";
  answers?: Record<string, { answers: string[] }>;
};
export type Request =
  | { operation: "models"; cursor?: string }
  | { operation: "list"; cursor?: string; archived: boolean; search?: string }
  | { operation: "start"; cwd: string; model?: string; access: AccessMode }
  | { operation: "resume"; threadId: string; access: AccessMode }
  | { operation: "send"; threadId: string; text: string; images: string[]; model?: string; effort?: string }
  | { operation: "read" | "archive" | "unarchive"; threadId: string }
  | { operation: "rename"; threadId: string; name: string }
  | { operation: "interrupt"; threadId: string; turnId: string };
