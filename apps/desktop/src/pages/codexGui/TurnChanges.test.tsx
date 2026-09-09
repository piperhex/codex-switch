// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DetailsContext } from "./detailsContext";
import { TurnMessage } from "./TurnMessage";
import type { Item, Turn } from "./types";

let root: Root;
let container: HTMLDivElement;
const panel = { open: vi.fn(), update: vi.fn() };
const patch = "@@ -1 +1,2 @@\n-old\n+new\n+extra\n";
const netDiff = `diff --git a/src/example.ts b/src/example.ts
--- a/src/example.ts
+++ b/src/example.ts
${patch}`;
const edit: Item = { id: "edit", type: "fileChange", status: "completed",
  changes: [{ path: "F:\\project\\src\\example.ts", kind: { type: "update" }, diff: patch }] };

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

async function render(items: Item[], extra: Partial<Turn> = {}) {
  const turn: Turn = { id: "turn", status: "inProgress", items, ...extra };
  await act(async () => root.render(<DetailsContext.Provider value={panel}>
    <TurnMessage turn={turn} running={turn.status === "inProgress"} active={false} />
  </DetailsContext.Provider>));
}

function cards() { return container.querySelectorAll("section[aria-label]"); }

it("shows only the final summary when item edits and the net diff describe the same files", async () => {
  await render([edit, { id: "command", type: "commandExecution", command: "npm test", status: "failed" }],
    { diff: netDiff });
  expect(cards()).toHaveLength(1);
  expect(cards()[0].getAttribute("aria-label")).toBe("本轮修改");
  expect(cards()[0].closest("details")).toBeNull();
  expect(cards()[0].textContent).toContain("src/example.ts");
  expect(cards()[0].textContent).not.toContain("F:");
  expect(cards()[0].textContent).toContain("+2−1");
  expect(container.textContent).toContain("运行失败 npm test");
  await act(async () => (cards()[0].querySelector("button") as HTMLButtonElement).click());
  expect(panel.open).toHaveBeenCalledWith(expect.objectContaining({
    title: "本轮修改", files: [expect.objectContaining({ path: "src/example.ts", raw: netDiff })],
  }));
});

it("updates one summary as edits accumulate, the net diff arrives, and the turn finishes", async () => {
  await render([edit]);
  expect(cards()).toHaveLength(1);
  const second: Item = { ...edit, id: "second",
    changes: [{ path: "src/other.ts", kind: { type: "add" }, diff: "other" }] };
  await render([edit, second]);
  expect(cards()).toHaveLength(1);
  expect(cards()[0].textContent).toContain("已编辑 2 个文件");
  await render([edit, second], { diff: netDiff });
  expect(cards()).toHaveLength(1);
  expect(cards()[0].textContent).toContain("已编辑 1 个文件");
  await render([edit, second, { id: "answer", type: "agentMessage", phase: "final_answer", text: "完成" }],
    { diff: netDiff, status: "completed" });
  expect(cards()).toHaveLength(1);
  expect(container.querySelector("article")!.compareDocumentPosition(cards()[0])
    & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});

it("keeps pending, failed, and declined edits as activities without claiming applied changes", async () => {
  await render(["inProgress", "failed", "declined"].map((status) => ({ ...edit, id: status, status })));
  expect(cards()).toHaveLength(0);
  expect(container.textContent).toContain("进行中");
  expect(container.textContent).toContain("失败");
  expect(container.textContent).toContain("已拒绝");
});
