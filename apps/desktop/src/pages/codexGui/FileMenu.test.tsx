// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { isTauri } from "@tauri-apps/api/core";
import { message } from "antd";
import { FileMenu } from "./FileMenu";
import { FileThreadContext, fileApi } from "./fileApi";
import { RichText } from "./RichText";

vi.mock("@tauri-apps/api/core", () => ({ isTauri: vi.fn(() => true), invoke: vi.fn() }));
let root: Root;
let host: HTMLDivElement;
const clipboard = vi.fn().mockResolvedValue(undefined);
const applications = [{ id: "vscode", name: "VS Code", kind: "editor" as const },
  { id: "terminal", name: "终端", kind: "terminal" as const }];
const trigger = () => host.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]')!;
const click = (element: HTMLElement) => act(async () => element.click());
function item(label: string) {
  return [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')]
    .find((element) => element.textContent === label)!;
}
async function render(path = "C:/project/report.txt", thread = "thread-one") {
  await act(async () => root.render(<FileThreadContext.Provider value={thread}>
    <FileMenu path={path} line={12} column={3}>报告</FileMenu>
  </FileThreadContext.Provider>));
}

beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.mocked(isTauri).mockReturnValue(true);
  vi.spyOn(fileApi, "applications").mockResolvedValue(applications);
  vi.spyOn(fileApi, "perform").mockResolvedValue({ path: "C:/project/report.txt", text: "文件内容", saved: true });
  vi.spyOn(message, "success").mockImplementation(() => Object.assign(() => {}, { then: vi.fn() }));
  vi.spyOn(message, "error").mockImplementation(() => Object.assign(() => {}, { then: vi.fn() }));
  Object.defineProperty(navigator, "clipboard", { value: { writeText: clipboard }, configurable: true });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await render();
});
afterEach(async () => {
  await act(async () => root.unmount()); host.remove();
  vi.restoreAllMocks(); vi.clearAllMocks(); vi.unstubAllGlobals();
});

it("opens a file menu without launching anything and passes the chosen editor and location", async () => {
  expect(fileApi.applications).not.toHaveBeenCalled();
  await click(trigger());
  expect(fileApi.perform).not.toHaveBeenCalled();
  expect(item("打开文件")).toBeTruthy();
  await click(item("在 VS Code 中打开"));
  expect(fileApi.perform).toHaveBeenCalledWith({ path: "C:/project/report.txt", line: 12, column: 3,
    threadId: "thread-one" }, { type: "open", application: "vscode" });
  expect(trigger().getAttribute("aria-expanded")).toBe("false");
});

it.each([["复制路径", "copyPath", "C:/project/report.txt"], ["复制文件内容", "copyContents", "文件内容"]])(
  "copies the resolved value for %s", async (label, type, copied) => {
    await click(trigger()); await click(item(label));
    expect(fileApi.perform).toHaveBeenCalledWith(expect.anything(), { type });
    expect(clipboard).toHaveBeenCalledWith(copied);
  },
);

it("does not report success when the save dialog is cancelled", async () => {
  vi.mocked(fileApi.perform).mockResolvedValue({ path: "C:/project/report.txt", saved: false });
  await click(trigger()); await click(item("另存为…"));
  expect(fileApi.perform).toHaveBeenCalledWith(expect.anything(), { type: "saveAs" });
  expect(message.success).not.toHaveBeenCalled();
});

it("keeps the menu dismissible while app discovery is pending and ignores stale responses", async () => {
  let resolve!: (value: typeof applications) => void;
  vi.mocked(fileApi.applications).mockReturnValue(new Promise((done) => { resolve = done; }));
  await click(trigger()); await render("C:/other.txt", "thread-two");
  await act(async () => resolve(applications));
  expect(trigger().getAttribute("aria-expanded")).toBe("false");
  expect(fileApi.perform).not.toHaveBeenCalled();
});

it("reports friendly failures in a compact message and allows retry", async () => {
  vi.mocked(fileApi.perform).mockRejectedValue("找不到这个文件，请确认文件仍然存在。");
  await click(trigger()); await click(item("打开文件"));
  expect(message.error).toHaveBeenCalledWith({ content: "找不到这个文件，请确认文件仍然存在。",
    style: { maxWidth: 400, marginInline: "auto" } });
  expect(trigger().disabled).toBe(false);
});

it("does not invoke host actions in a browser and still copies a file path", async () => {
  vi.mocked(isTauri).mockReturnValue(false);
  await render(); await click(trigger());
  expect(item("打开文件").getAttribute("aria-disabled")).toBe("true");
  expect(fileApi.applications).not.toHaveBeenCalled();
  await click(item("复制路径"));
  expect(clipboard).toHaveBeenCalledWith("C:/project/report.txt");
  expect(fileApi.perform).not.toHaveBeenCalled();
});

it("renders relative and file URL markdown destinations as clickable files", async () => {
  await act(async () => root.render(<RichText text={
    "[报告](docs/report.pdf:12) 和 [文件](file:///C:/report.txt) 和 [网页](https://example.com)"
  } />));
  expect(host.querySelectorAll('button[aria-haspopup="menu"]')).toHaveLength(2);
  expect(host.querySelector("a")?.href).toBe("https://example.com/");
});

it("preserves literal URL punctuation in paths supplied by edited-file cards", async () => {
  await render("C:/project/report%20#L12.txt");
  await click(trigger()); await click(item("打开文件"));
  expect(fileApi.perform).toHaveBeenCalledWith(expect.objectContaining({ path: "C:/project/report%20#L12.txt" }),
    { type: "open", application: "default" });
});
