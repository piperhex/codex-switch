import { describe, expect, it } from "vitest";
import { conversation, reduceConversation, reduceEvent } from "./events";
import { initialState } from "./preferences";
import type { GuiEvent, Thread } from "./types";
import { requestErrorDetails } from "./requestError";

const thread: Thread = { id: "one", cwd: "", preview: "", updatedAt: 1,
  turns: [{ id: "first", status: "inProgress", items: [] }] };
const retry = (turnId = "first"): GuiEvent => ({ method: "error", params: { threadId: "one", turnId,
  willRetry: true, error: { message: "HTTP 502 Bad Gateway", additionalDetails: "upstream timed out" } } });

describe("request errors belong to their turn", () => {
  it("keeps upstream reasons while hiding echoed credentials", () => {
    const text = requestErrorDetails({ message: "HTTP 502: Bearer test-secret",
      additionalDetails: 'upstream timeout: https://user:pass@example.com?token=query-secret, "api_key":"key-secret"' });
    expect(text).toContain("HTTP 502");
    expect(text).toContain("upstream timeout");
    for (const secret of ["test-secret", "user:pass", "query-secret", "key-secret"]) expect(text).not.toContain(secret);
    expect(requestErrorDetails({ message: " same ", additionalDetails: "same" })).toBe("same");
  });

  it("retains retry details after completion, history refresh, and a new reply", () => {
    let value = reduceConversation(conversation(thread), retry());
    expect(value.error).toBe("");
    expect(value.turns[0].retryError).toEqual(retry().params.error);
    value = reduceConversation(value, { method: "turn/completed", params: {
      turn: { id: "first", status: "completed", items: [], error: null } } });
    value = conversation({ ...thread, turns: [{ id: "first", status: "completed", items: [] }] }, value);
    value = reduceConversation(value, { method: "turn/started", params: {
      turn: { id: "second", status: "inProgress", items: [] } } });
    expect(value.turns[0].retryError).toEqual(retry().params.error);
    expect(value.turns[1].retryError).toBeUndefined();
    expect(value.turns[1].error).toBeUndefined();
  });

  it("replaces retry details with the latest error and retains the final failure", () => {
    let value = reduceConversation(conversation(thread), retry());
    value = reduceConversation(value, { method: "error", params: { turnId: "first", willRetry: false,
      error: { message: "HTTP 429 Too Many Requests", additionalDetails: "quota exceeded" } } });
    value = reduceConversation(value, { method: "turn/completed", params: {
      turn: { id: "first", status: "failed", items: [] } } });
    expect(value.error).toBe("");
    expect(value.turns[0].error?.additionalDetails).toBe("quota exceeded");
  });

  it("uses the active turn for older events and never assigns background errors to the selected conversation", () => {
    const value = conversation(thread);
    const notification = retry();
    delete notification.params.turnId;
    const state = { ...initialState(), selected: "two", conversations: {
      one: value, two: conversation({ ...thread, id: "two" }),
    } };
    const next = reduceEvent(state, notification);
    expect(next.conversations.one.turns[0].retryError).toBeDefined();
    expect(next.conversations.two.turns[0].retryError).toBeUndefined();
    const noActive = { ...value, activeTurn: null };
    expect(reduceConversation(noActive, notification).turns).toBe(noActive.turns);
  });
});
