import { expect, it } from "vitest";
import { messageWindow } from "./messageWindow";
import type { Turn } from "./types";

function history(): Turn[] {
  return Array.from({ length: 7 }, (_, turn) => ({ id: `turn-${turn}`, status: "completed",
    items: Array.from({ length: 5 }, (_, item) => ({ id: `item-${turn * 5 + item}`, type: "agentMessage" })),
  }));
}
const ids = (range: ReturnType<typeof messageWindow>) => range.entries.flatMap((entry) => entry.items.map((item) => item.id));

it("limits the initial window to ten items, then includes ten older items at a time", () => {
  const turns = history();
  let range = messageWindow(turns);
  expect(ids(range)).toHaveLength(10);
  expect(ids(range)[0]).toBe("item-25");
  for (const count of [20, 30, 35]) {
    range = messageWindow(turns, { start: range.start, older: true });
    expect(ids(range)).toHaveLength(count);
    expect(range.hasMore).toBe(count < 35);
  }
  expect(range.entries[0].turn).toBe(turns[0]);
});

it("limits a single large turn without discarding its full data or prior interruption context", () => {
  const turns = history();
  turns[0].status = "interrupted";
  turns[1].items = turns.flatMap((turn) => turn.items);
  const range = messageWindow(turns.slice(0, 2));
  expect(range.entries).toHaveLength(1);
  expect(range.entries[0].items).toHaveLength(10);
  expect(range.entries[0].turn.items).toHaveLength(35);
  expect(range.entries[0].followsInterruption).toBe(true);
});

it("keeps the earliest loaded item when streaming appends new content and resets a removed cursor", () => {
  const turns = history();
  const first = messageWindow(turns);
  turns[6].items.push({ id: "new", type: "agentMessage" });
  expect(ids(messageWindow(turns, { start: first.start }))).toHaveLength(11);
  expect(ids(messageWindow(turns, { start: first.start, older: true }))).toHaveLength(21);
  turns[5].items = [];
  expect(ids(messageWindow(turns, { start: first.start }))).toHaveLength(10);
  expect(messageWindow([])).toEqual({ entries: [], hasMore: false, start: undefined });
});

it("retains the empty active turn so processing remains visible before the first item", () => {
  const turns = history();
  turns.push({ id: "active", status: "inProgress", items: [] });
  const range = messageWindow(turns);
  expect(ids(range)).toHaveLength(10);
  expect(range.entries.at(-1)?.turn.id).toBe("active");
});

it("does not offer another page when only empty turns precede the first message", () => {
  const turns: Turn[] = [{ id: "empty", status: "interrupted", items: [] },
    { id: "last", status: "completed", items: [{ id: "only", type: "agentMessage" }] }];
  const first = messageWindow(turns);
  expect(first.hasMore).toBe(false);
  expect(messageWindow(turns, { start: first.start }).hasMore).toBe(false);
});
