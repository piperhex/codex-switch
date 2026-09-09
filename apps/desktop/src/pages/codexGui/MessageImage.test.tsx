// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { guiApi } from "./api";
import { ImageThreadContext } from "./useImageSource";
import { RichText } from "./RichText";

vi.mock("./api", () => ({ guiApi: { request: vi.fn() } }));
const image = "data:image/png;base64,iVBORw0KGgo=";
let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.resetAllMocks();
  container = document.createElement("div");
  root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); vi.unstubAllGlobals(); });

async function render(text: string, thread = "task") {
  await act(async () => root.render(<ImageThreadContext.Provider value={thread}>
    <RichText text={text} />
  </ImageThreadContext.Provider>));
}

it("previews Windows, file URL, and relative Markdown images through scoped IPC", async () => {
  vi.mocked(guiApi.request).mockResolvedValue({ url: image });
  for (const source of ["C:/images/page.png", "C:\\images\\page.png", "file:///C:/images/page.png", "./page.png"]) {
    await render(`![页面截图](${source})`);
    expect(guiApi.request).toHaveBeenLastCalledWith({ operation: "imagePreview", threadId: "task", source });
    expect(container.querySelector("img")?.getAttribute("src")).toBe(image);
    expect(container.querySelector("img")?.alt).toBe("页面截图");
  }
});

it("reports failed reads and retries them without loading a local endpoint", async () => {
  vi.mocked(guiApi.request).mockRejectedValueOnce(new Error("missing")).mockResolvedValue({ url: image });
  await render("![截图](./page.png)");
  expect(container.textContent).toContain("图片加载失败");
  expect(container.querySelector("img")).toBeNull();
  await act(async () => container.querySelector("button")?.click());
  expect(guiApi.request).toHaveBeenCalledTimes(2);
  expect(container.querySelector("img")?.getAttribute("src")).toBe(image);
});

it("previews local screenshot links while preserving ordinary file references", async () => {
  vi.mocked(guiApi.request).mockResolvedValue({ url: image });
  for (const source of ["C:/Users/ZH/AppData/Local/Temp/baidu-screenshot-20260909.png",
    "file:///C:/Users/ZH/AppData/Local/Temp/baidu-screenshot-20260909.png", "./page.png"]) {
    await render(`已重新截图：[查看最新截图](${source})。 [说明](./README.md)`);
    expect(guiApi.request).toHaveBeenLastCalledWith({ operation: "imagePreview", threadId: "task", source });
    expect(container.querySelector("img")?.getAttribute("src")).toBe(image);
    expect(container.querySelector("img")?.alt).toBe("查看最新截图");
    expect(container.querySelector('[aria-label="放大查看：查看最新截图"]')).not.toBeNull();
    expect(container.querySelector('[aria-label="复制文件路径"]')).not.toBeNull();
  }
});

it("ignores late results when switching tasks and shares in-flight reads", async () => {
  let resolveFirst: (value: { url: string }) => void = () => {};
  vi.mocked(guiApi.request).mockReturnValueOnce(new Promise((resolve) => { resolveFirst = resolve; }))
    .mockResolvedValue({ url: image });
  await render("![一](./page.png) ![二](./page.png)");
  expect(guiApi.request).toHaveBeenCalledTimes(1);
  expect(container.textContent).toContain("正在加载");
  await render("![新任务](./new.png)", "other");
  await act(async () => resolveFirst({ url: "data:image/png;base64,b2xk" }));
  expect(container.querySelectorAll("img")).toHaveLength(1);
  expect(container.querySelector("img")?.getAttribute("src")).toBe(image);
});

it("keeps unsupported and executable URLs out of both IPC and the image element", async () => {
  await render("![接口](/__codex_switch__/api/image.png) ![脚本](javascript:bad.png) ![远程文件](file://host/a.png)");
  expect(guiApi.request).not.toHaveBeenCalled();
  expect(container.querySelector("img")).toBeNull();
});
