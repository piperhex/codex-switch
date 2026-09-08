// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DetailsWorkspace } from "./DetailsWorkspace";
import { DiffView } from "./DiffView";
import { changedFiles } from "./diff";

let root: Root;
let container: HTMLDivElement;
const files = changedFiles([{ path: "example.ts", kind: { type: "update" },
  diff: "@@ -1 +1 @@\n-const value = 1;\n+const value = 2;\n" }]);
const originalCapture = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "setPointerCapture");

function Fixture({ selected = "one", changes = files }: { selected?: string; changes?: typeof files }) {
  return <DetailsWorkspace selected={selected} active>
    <p>对话正文</p><DiffView files={changes} title="本轮修改" />
  </DetailsWorkspace>;
}
const button = (label: string) => container.querySelector(`button[aria-label="${label}"]`) as HTMLButtonElement;
const panel = () => container.querySelector('aside[aria-label="文件更改详情"]') as HTMLElement;
const trigger = () => container.querySelector('button[aria-label^="查看本轮修改"]') as HTMLButtonElement;

beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 1200, 800));
  Object.defineProperty(HTMLElement.prototype, "setPointerCapture", { configurable: true, value: vi.fn() });
  localStorage.clear();
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  await act(async () => root.render(<Fixture />));
});
afterEach(async () => {
  await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals();
  if (originalCapture) Object.defineProperty(HTMLElement.prototype, "setPointerCapture", originalCapture);
  else Reflect.deleteProperty(HTMLElement.prototype, "setPointerCapture");
});

it("opens diff in a right panel and preserves layout when minimized, restored, and expanded", async () => {
  expect(container.querySelector("code")).toBeNull();
  trigger().focus();
  await act(async () => trigger().click());
  expect(panel().hidden).toBe(false);
  expect(panel().style.width).toBe("560px");
  expect(panel().textContent).toContain("const value = 2;");
  expect(panel().querySelector(".hljs-keyword")?.textContent).toBe("const");
  expect(document.activeElement).toBe(button("关闭详情抽屉"));
  const split = [...panel().querySelectorAll("button")].find((node) => node.textContent === "并排")!;
  await act(async () => split.click());
  await act(async () => button("最小化详情抽屉").click());
  expect(panel().hidden).toBe(true);
  await act(async () => [...container.querySelectorAll("button")].find((node) =>
    node.textContent === "恢复文件更改")!.click());
  expect(split.getAttribute("aria-pressed")).toBe("true");
  await act(async () => button("展开详情抽屉").click());
  expect(panel().style.width).toBe("1200px");
  await act(async () => button("还原抽屉宽度").click());
  expect(panel().style.width).toBe("560px");
  await act(async () => panel().dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
  expect(panel()).toBeNull();
  expect(document.activeElement).toBe(trigger());
});

it("drags its left edge, persists width, supports keyboard resizing, and cleans up pointer state", async () => {
  await act(async () => trigger().click());
  const grip = container.querySelector('[role="separator"]')!;
  const pointer = async (type: string, clientX: number) => {
    const event = new MouseEvent(type, { bubbles: true, button: 0, clientX });
    Object.defineProperty(event, "pointerId", { value: 1 });
    await act(async () => grip.dispatchEvent(event));
  };
  await pointer("pointerdown", 600); await pointer("pointermove", 480); await pointer("pointerup", 480);
  expect(panel().style.width).toBe("680px");
  expect(localStorage.getItem("codex-switch:gui-details-width")).toBe("680");
  expect(document.body.style.cursor).not.toBe("col-resize");
  await act(async () => grip.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })));
  expect(panel().style.width).toBe("656px");
  await pointer("pointerdown", 500); await pointer("pointermove", 450);
  expect(document.body.style.userSelect).toBe("none");
  await act(async () => button("关闭详情抽屉").click());
  expect(document.body.style.userSelect).not.toBe("none");
});

it("updates an open live diff and clears it when switching conversations", async () => {
  await act(async () => trigger().click());
  const updated = changedFiles([{ path: "example.ts", kind: { type: "add" }, diff: "streamed update\n" }]);
  await act(async () => root.render(<Fixture changes={updated} />));
  expect(panel().textContent).toContain("streamed update");
  await act(async () => root.render(<Fixture changes={updated} selected="two" />));
  expect(panel()).toBeNull();
});
