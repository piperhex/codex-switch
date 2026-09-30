import type { BrowserContext } from "@playwright/test";
import type { ModelSettingsSnapshot } from "../src/pages/codexGui/threadModelSettings";
import type { ModelSelection } from "../src/pages/codexGui/modelSelection";
import type { QueueSnapshot } from "../src/pages/codexGui/queueJournal";

export function modelSettingsBackend(liveUpdate?: ModelSettingsSnapshot["liveUpdate"]) {
  const saved = new Map<string | null, ModelSettingsSnapshot>();
  const events: { name: string; payload: unknown }[] = [];
  const sends: Record<string, unknown>[] = [];
  const usage: (() => void)[] = [];
  const pendingModels: (() => void)[] = [];
  let modelsPaused = false;
  let queue: QueueSnapshot = { revision: 0, threads: {} };
  const thread = (id: string) => ({ id, cwd: "", preview: id, updatedAt: 1, turns: [] });
  const models = ["first", "second"].map((model, index) => ({ id: model, model,
    displayName: index === 0 ? "模型一" : "模型二", isDefault: index === 0, defaultReasoningEffort: "medium",
    supportedReasoningEfforts: ["low", "medium", "high", "xhigh"].map((reasoningEffort) =>
      ({ reasoningEffort, description: "" })),
  }));
  async function attach(context: BrowserContext) {
    await context.route("**/__codex_switch__/api/invoke", async (route) => {
      const { command, args } = route.request().postDataJSON() as {
        command: string; args: { threadId?: string; selection: ModelSelection;
          cursor?: { sequence: number }; request: Record<string, unknown>; snapshot: QueueSnapshot };
      };
      let result: unknown = {};
      const threadId = args.threadId ?? null;
      if (command === "codex_gui_connect") result = [];
      if (command === "codex_gui_queue_read") result = queue;
      if (command === "codex_gui_queue_save") {
        queue = { ...args.snapshot, revision: queue.revision + 1 };
        result = queue;
      }
      if (command === "codex_gui_model_settings") {
        result = saved.get(threadId) ?? { threadId, selection: null, revision: 0 };
      }
      if (command === "codex_gui_set_model_settings") {
        const snapshot = { threadId, selection: args.selection, revision: (saved.get(threadId)?.revision ?? 0) + 1, liveUpdate };
        saved.set(threadId, snapshot);
        events.push({ name: "codex-gui-model-settings-changed", payload: snapshot });
        result = snapshot;
      }
      if (command === "codex_gui_events") result = { cursor: { streamId: "test", sequence: events.length },
        reset: false, events: args.cursor ? events.slice(args.cursor.sequence) : [] };
      if (command === "codex_gui_request") {
        const request = args.request;
        let data: unknown = {};
        if (request.operation === "models") {
          if (modelsPaused) await new Promise<void>((resolve) => pendingModels.push(resolve));
          data = { data: models, nextCursor: null };
        }
        if (request.operation === "list") data = { data: [thread("a"), thread("b")], nextCursor: null };
        if (["read", "resume", "start"].includes(String(request.operation))) {
          data = { thread: thread(String(request.threadId ?? "created")) };
        }
        if (request.operation === "send") {
          sends.push(request); data = { turn: { id: "reply", status: "completed", items: [] } };
        }
        result = { data };
      }
      if (command === "codex_gui_usage_summary") {
        await new Promise<void>((resolve) => usage.push(resolve));
        result = { totalTokens: 123 };
      }
      await route.fulfill({ json: { ok: true, result } });
    });
  }
  return { attach, sends, pauseModels: () => { modelsPaused = true; },
    addModel: (model: string) => models.push({ ...models[0], id: model, model, displayName: model, isDefault: false }),
    releaseModels: () => { modelsPaused = false; pendingModels.splice(0).forEach((resolve) => resolve()); },
    startTurn: (threadId: string) => events.push({ name: "codex-gui-event",
    payload: { method: "turn/started", params: { threadId,
      turn: { id: "live", status: "inProgress", items: [] } } } }), releaseUsage: () => usage.splice(0).forEach((resolve) => resolve()) };
}
