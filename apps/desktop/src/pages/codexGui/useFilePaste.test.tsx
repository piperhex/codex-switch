// @vitest-environment jsdom
import { act, type ClipboardEvent, type KeyboardEvent } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { invoke } from "../../api/backend";
import { GuiController } from "./controller";
import { useComposerDraft } from "./useComposerDraft";
import { ComposerReferences } from "./ComposerReferences";

vi.mock("../../api/backend", () => ({ invoke: vi.fn(), isDesktopApp: true }));
let root: Root;
let host: HTMLDivElement;
let controller: GuiController;
let editor: ReturnType<typeof useComposerDraft>;
const attachment = { kind: "file" as const, name: "说明 文档.txt", path: "C:/files/说明 文档.txt" };
function Fixture({ draftKey = "new" }: { draftKey?: string }) {
  editor = useComposerDraft(draftKey, controller);
  return <ComposerReferences items={editor.draft.attachments ?? []}
    disabled={false} onRemove={editor.removeAttachment} />;
}
const render = (draftKey = "new") => act(async () => root.render(<Fixture draftKey={draftKey} />));
const keydown = () => editor.pasteKeyDown({ key: "v", ctrlKey: true } as KeyboardEvent<HTMLElement>);
function paste(files: File[] = [], text = "") {
  const event = { clipboardData: { items: files.map((file) =>
    ({ kind: "file", getAsFile: () => file })), getData: () => text }, preventDefault: vi.fn() };
  editor.paste(event as unknown as ClipboardEvent<HTMLElement>);
  return event;
}
beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.mocked(invoke).mockReset().mockResolvedValue([]);
  controller = new GuiController();
  vi.spyOn(controller, "send").mockResolvedValue(true);
  vi.spyOn(controller, "report");
  host = document.createElement("div");
  root = createRoot(host);
  await render();
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("pastes Explorer files without a paste event, shows removable pills and sends the remaining file", async () => {
  const second = { ...attachment, name: "other.txt", path: "C:/files/other.txt" };
  vi.mocked(invoke).mockResolvedValue([attachment, second]);
  await act(async () => keydown());
  expect(host.textContent).toContain(attachment.name);
  const remove = host.querySelector<HTMLButtonElement>("button")!;
  expect(remove.getAttribute("aria-label")).toBe("移除附件：" + attachment.name);
  expect(remove.parentElement?.querySelector("svg")).not.toBeNull();
  await act(async () => remove.click());
  expect(editor.draft.attachments).toEqual([second]);
  await act(async () => editor.send());
  expect(controller.send).toHaveBeenCalledWith("", [], [], [second]);
  expect(host.textContent).toBe("");
});

it("coalesces shortcut and paste events, blocks sending until complete and deduplicates repeated files", async () => {
  let resolve!: (value: unknown) => void;
  vi.mocked(invoke).mockImplementation(() => new Promise((done) => { resolve = done; }));
  act(() => { keydown(); paste(); });
  expect(invoke).toHaveBeenCalledTimes(1);
  expect(editor.reading).toBe(true);
  await act(async () => editor.send());
  expect(controller.send).not.toHaveBeenCalled();
  await act(async () => resolve([attachment]));
  expect(editor.reading).toBe(false);
  vi.mocked(invoke).mockResolvedValue([attachment]);
  await act(async () => paste());
  expect(editor.draft.attachments).toEqual([attachment]);
});

it("keeps delayed file reads with their original conversation and preserves files after send failure", async () => {
  let resolve!: (value: unknown) => void;
  vi.mocked(invoke).mockImplementation(() => new Promise((done) => { resolve = done; }));
  act(() => keydown());
  await render("other");
  await act(async () => resolve([attachment]));
  expect(editor.draft.attachments).toBeUndefined();
  await render();
  vi.mocked(controller.send).mockResolvedValue(false);
  await act(async () => editor.send());
  expect(editor.draft.attachments).toEqual([attachment]);
});

it("leaves ordinary text paste alone and does not report native clipboard failures for text", async () => {
  vi.mocked(invoke).mockRejectedValue(new Error("busy"));
  await act(async () => {
    keydown();
    expect(paste([], "hello").preventDefault).not.toHaveBeenCalled();
  });
  expect(controller.report).not.toHaveBeenCalled();
});

it("falls back to screenshot bytes when the clipboard contains no file paths", async () => {
  const image = new File(["image"], "screenshot.png", { type: "image/png" });
  vi.spyOn(FileReader.prototype, "readAsDataURL").mockImplementation(function (this: FileReader) {
    Object.defineProperty(this, "result", { value: "data:image/png;base64,aGVsbG8=" });
    this.dispatchEvent(new ProgressEvent("load"));
  });
  await act(async () => { keydown(); paste([image]); });
  expect(editor.draft.images).toHaveLength(1);
  expect(editor.draft.attachments).toBeUndefined();
});

it("prefers native file paths over duplicate browser image representations", async () => {
  vi.mocked(invoke).mockResolvedValue([attachment]);
  await act(async () => { keydown(); paste([new File(["x"], "preview.png", { type: "image/png" })]); });
  expect(editor.draft.attachments).toEqual([attachment]);
  expect(editor.draft.images).toEqual([]);
});

it("reports inaccessible native clipboard files and allows retry", async () => {
  vi.mocked(invoke).mockRejectedValueOnce(new Error("missing")).mockResolvedValue([attachment]);
  await act(async () => { keydown(); paste(); });
  expect(controller.report).toHaveBeenCalledWith("文件粘贴失败，请重新复制后再试。");
  expect(editor.reading).toBe(false);
  await act(async () => keydown());
  expect(editor.draft.attachments).toEqual([attachment]);
});
