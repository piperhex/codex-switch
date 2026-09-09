// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Messages } from "./Messages";
import { conversation } from "./events";
import type { Item, Turn } from "./types";

let root: Root;
let container: HTMLDivElement;
const image = "data:image/png;base64,iVBORw0KGgo=";
const originalScrollTo = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollTo");
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  Object.defineProperty(HTMLElement.prototype, "scrollTo", { configurable: true, value: vi.fn() });
  container = document.createElement("div");
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount()); vi.restoreAllMocks(); vi.unstubAllGlobals();
  if (originalScrollTo) Object.defineProperty(HTMLElement.prototype, "scrollTo", originalScrollTo);
  else Reflect.deleteProperty(HTMLElement.prototype, "scrollTo");
});

async function render(items: Item[], extra: Partial<Turn> = {}) {
  const value = conversation({ id: "test", cwd: "F:/project", preview: "", updatedAt: 1,
    turns: [{ id: "turn", status: "completed", items, ...extra }] });
  await act(async () => root.render(<Messages selected="test" value={value} />));
}

it("keeps commentary in expandable process groups while showing steering and final replies", async () => {
  await render([
    { id: "commentary", type: "agentMessage", phase: "commentary", text: "正在检查" },
    { id: "steer", type: "userMessage", content: [{ type: "text", text: "也检查边界情况" }] },
    { id: "command", type: "commandExecution", command: "npm test", status: "completed", aggregatedOutput: "PASS" },
    { id: "final", type: "agentMessage", phase: "final_answer", text: "检查完成" },
  ]);
  const articles = [...container.querySelectorAll("article")];
  expect(articles[0].closest("details")?.open).toBe(false);
  expect(articles[1].closest("details")).toBeNull();
  expect(articles[2].closest("details")).toBeNull();
  expect(container.textContent).toContain("PASS");
});

it("highlights code safely, preserves GFM tables, and exposes exact code copying", async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal("navigator", { clipboard: { writeText } });
  const code = 'const html = "<script>bad()</script>";';
  await render([{ id: "answer", type: "agentMessage",
    text: `\`\`\`javascript\n${code}\n\`\`\`\n\n|项目|结果|\n|---|---|\n|检查|通过|` }]);
  expect(container.querySelector("script")).toBeNull();
  expect(container.querySelector(".hljs-keyword")?.textContent).toBe("const");
  expect(container.querySelector("table")?.textContent).toContain("检查通过");
  await act(async () => (container.querySelector('[aria-label="复制代码"]') as HTMLButtonElement).click());
  expect(writeText).toHaveBeenCalledWith(code);
});

it("renders tool inputs, rich outputs, search results, failures, and inline images", async () => {
  await render([
    { id: "input", type: "userMessage", content: [{ type: "image", url: image }] },
    { id: "tool", type: "mcpToolCall", tool: "search", arguments: { query: "test" }, status: "completed",
      result: { content: [{ type: "text", text: "**工具结果**" }], structuredContent: { count: 1 } } },
    { id: "error", type: "dynamicToolCall", tool: "demo", status: "failed", error: { message: "工具执行失败" } },
    { id: "web", type: "webSearch", action: { type: "search", queries: ["查询一", "查询二"] },
      results: [{ title: "官方文档", url: "https://example.com/docs", snippet: "相关说明" }] },
    { id: "generated", type: "imageGeneration", result: "iVBORw0KGgo=", status: "completed" },
  ]);
  expect(container.textContent).toContain('"query": "test"');
  expect(container.querySelector("strong")?.textContent).toBe("工具结果");
  expect(container.textContent).toContain("工具执行失败");
  expect(container.textContent).toContain("查询二");
  expect(container.querySelector('a[href="https://example.com/docs"]')).not.toBeNull();
  expect(container.querySelectorAll(`img[src="${image}"]`)).toHaveLength(2);
});

it("keeps rejected changes out of the applied file summary", async () => {
  await render([{ id: "rejected", type: "fileChange", status: "declined",
    changes: [{ path: "file.txt", kind: { type: "add" }, diff: "new" }] }]);
  expect(container.textContent).toContain("未应用");
  expect(container.textContent).not.toContain("文件修改记录");
});

it("shows completed imagegen results below the final reply outside collapsed activity", async () => {
  const generated: Item = { id: "generated", type: "imageGeneration", status: "inProgress" };
  const final: Item = { id: "final", type: "agentMessage", phase: "final_answer", text: "已生成卡通小鸟。" };
  await render([generated], { status: "inProgress" });
  expect(container.querySelector('[aria-label="生成的图片"]')).toBeNull();
  const completed = { ...generated, status: "completed", result: "iVBORw0KGgo=",
    savedPath: "C:/generated_images/task/bird.png" };
  await render([completed, final]);
  const gallery = container.querySelector('[aria-label="生成的图片"]')!;
  expect(gallery.querySelector("img")?.getAttribute("src")).toBe(image);
  expect(gallery.closest("details")).toBeNull();
  expect(container.querySelectorAll("img")).toHaveLength(1);
  expect(container.querySelector("article")!.compareDocumentPosition(gallery)
    & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  // A fresh render of persisted turn items must restore the same visible result.
  await render([]);
  await render([completed, final]);
  expect(container.querySelector('[aria-label="生成的图片"] img')).not.toBeNull();
});

it("keeps multiple generated images visible but excludes failed generations and viewed inputs", async () => {
  await render([
    { id: "one", type: "imageGeneration", status: "completed", result: "iVBORw0KGgo=" },
    { id: "duplicate", type: "imageGeneration", status: "completed", result: "iVBORw0KGgo=" },
    { id: "two", type: "imageGeneration", status: "completed", imageUrl: "https://example.com/two.png" },
    { id: "failed", type: "imageGeneration", status: "failed", failure: { message: "生成失败" } },
    { id: "view", type: "imageView", imageUrl: "https://example.com/reference.png" },
  ]);
  expect(container.querySelectorAll('[aria-label="生成的图片"] img')).toHaveLength(2);
  expect(container.textContent).toContain("生成失败");
});
