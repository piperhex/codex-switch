// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest";
import { conversation } from "./events";
import { rememberTurnDetails } from "./turnDetailsStorage";

afterEach(() => sessionStorage.clear());
it("restores each turn's net diff and plan after a fresh controller loads history", () => {
  const thread = { id: "thread", preview: "", cwd: "", updatedAt: 1, turns: [
    { id: "first", status: "completed", items: [], diff: "net patch", plan: [{ step: "检查", status: "completed" }] },
    { id: "next", status: "completed", items: [], diff: "next patch" },
  ] };
  const value = conversation(thread);
  rememberTurnDetails(value, "first"); rememberTurnDetails(value, "next");
  const history = { ...thread, turns: thread.turns.map(({ diff, plan, ...turn }) => turn) };
  expect(conversation(history).turns[0]).toMatchObject({ diff: "net patch", plan: [{ step: "检查", status: "completed" }] });
  expect(conversation(history).turns[1].diff).toBe("next patch");
  expect(conversation({ ...history, id: "other" }).turns[0].diff).toBeUndefined();
});
it("falls back to server history when optional metadata is malformed or too large", () => {
  sessionStorage.setItem("codex-switch:gui-turn-details:v1", 'not json');
  const thread = { id: "thread", preview: "", cwd: "", updatedAt: 1, turns: [] };
  expect(conversation(thread).turns).toEqual([]);
  const value = conversation({ ...thread, turns: [{ id: "big", status: "completed", items: [], diff: "x".repeat(600_000) }] });
  rememberTurnDetails(value, "big");
  expect(sessionStorage.getItem("codex-switch:gui-turn-details:v1")).toBe("[]");
});
