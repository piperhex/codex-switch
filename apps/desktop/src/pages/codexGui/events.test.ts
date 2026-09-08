import { describe, expect, it } from "vitest";
import { conversation, reduceConversation, reduceEvent } from "./events";
import { initialState } from "./preferences";
import type { GuiEvent, Thread } from "./types";

const thread: Thread = { id: "one", cwd: "D:/project", preview: "hello", updatedAt: 1, turns: [] };
const event = (method: string, params: GuiEvent["params"]): GuiEvent => ({
  method, params: { threadId: "one", turnId: "turn", ...params },
});

describe("Codex GUI event projection", () => {
  it("reconciles streamed deltas with authoritative completed items without duplicates", () => {
    let value = conversation(thread);
    value = reduceConversation(value, event("turn/started", { turn: { id: "turn", status: "inProgress", items: [] } }));
    value = reduceConversation(value, event("item/agentMessage/delta", { itemId: "answer", delta: "hel" }));
    value = reduceConversation(value, event("item/agentMessage/delta", { itemId: "answer", delta: "lo" }));
    expect(value.turns[0].items[0].text).toBe("hello");
    value = reduceConversation(value, event("item/completed", {
      item: { id: "answer", type: "agentMessage", text: "hello!" } }));
    value = reduceConversation(value, event("turn/completed", {
      turn: { id: "turn", status: "completed", items: [] } }));
    expect(value.turns[0].items).toHaveLength(1);
    expect(value.turns[0].items[0].text).toBe("hello!");
    expect(value.activeTurn).toBeNull();
  });

  it("keeps command output and indexed reasoning parts separate from assistant text", () => {
    let value = conversation(thread);
    value = reduceConversation(value, event("item/commandExecution/outputDelta", { itemId: "cmd", delta: "PASS\n" }));
    value = reduceConversation(value, event("item/reasoning/summaryTextDelta", {
      itemId: "reason", delta: "step 2", summaryIndex: 1 }));
    expect(value.turns[0].items[0].aggregatedOutput).toBe("PASS\n");
    expect(value.turns[0].items[1].summary?.[1]).toBe("step 2");
  });

  it("preserves simultaneous background conversations and resolves approvals", () => {
    const state = { ...initialState(), selected: "two", conversations: { one: conversation(thread) } };
    const pending: GuiEvent = { ...event("item/fileChange/requestApproval", {}), id: 0 };
    let value = reduceEvent(state, pending);
    expect(value.approvals).toHaveLength(1);
    value = reduceEvent(value, event("item/agentMessage/delta", { itemId: "answer", delta: "background" }));
    expect(value.selected).toBe("two");
    expect(value.conversations.one.turns[0].items[0].text).toBe("background");
    value = reduceEvent(value, event("serverRequest/resolved", { requestId: 0 }));
    expect(value.approvals).toHaveLength(0);
  });

  it("clears stale running indicators and approvals on connection loss", () => {
    const value = conversation({ ...thread, turns: [{ id: "turn", status: "inProgress", items: [] }] });
    const state = { ...initialState(), conversations: { one: value }, sending: true };
    const next = reduceEvent(state, event("connection/closed", {}));
    expect(next.conversations.one.activeTurn).toBeNull();
    expect(next.connection).toBe("offline");
    expect(next.sending).toBe(false);
  });
});
