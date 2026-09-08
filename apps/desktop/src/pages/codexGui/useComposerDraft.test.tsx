// @vitest-environment jsdom
import { act, type ClipboardEvent } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { GuiController } from "./controller";
import { MAX_IMAGE_BYTES, useComposerDraft } from "./useComposerDraft";

let root: Root;
let container: HTMLDivElement;
let controller: GuiController;
let editor: ReturnType<typeof useComposerDraft>;
let readers: FileReader[];
const imageUrl = "data:image/png;base64,iVBORw0KGgo=";
const file = () => new File(["image"], "截图.png", { type: "image/png" });

function Fixture({ draftKey }: { draftKey: string }) {
  editor = useComposerDraft(draftKey, controller);
  return null;
}
const render = (draftKey = "new") => act(async () => root.render(<Fixture draftKey={draftKey} />));
const finish = (reader = readers[0]) => act(async () => {
  Object.defineProperty(reader, "result", { value: imageUrl });
  reader.dispatchEvent(new ProgressEvent("load"));
});

beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  readers = [];
  vi.spyOn(FileReader.prototype, "readAsDataURL").mockImplementation(function (this: FileReader) {
    readers.push(this);
  });
  controller = new GuiController();
  vi.spyOn(controller, "send").mockResolvedValue(true);
  vi.spyOn(controller, "report");
  container = document.createElement("div");
  root = createRoot(container);
  await render();
});

afterEach(async () => {
  await act(async () => root.unmount());
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function clipboard(files: File[]): ClipboardEvent<HTMLTextAreaElement> {
  return { clipboardData: { items: files.map((value) => ({ kind: "file", type: value.type,
    getAsFile: () => value })) }, preventDefault: vi.fn() } as unknown as ClipboardEvent<HTMLTextAreaElement>;
}

it("leaves ordinary text paste alone and sends pasted images without requiring text", async () => {
  const textPaste = clipboard([]);
  act(() => editor.paste(textPaste));
  expect(textPaste.preventDefault).not.toHaveBeenCalled();
  const paste = clipboard([file()]);
  act(() => editor.paste(paste));
  expect(paste.preventDefault).toHaveBeenCalled();
  expect(editor.reading).toBe(true);
  await act(async () => editor.send());
  expect(controller.send).not.toHaveBeenCalled();
  await finish();
  await act(async () => editor.send());
  expect(controller.send).toHaveBeenCalledWith("", [imageUrl]);
  expect(editor.draft.images).toEqual([]);
});

it("keeps edits and images with their original conversation when reads finish later", async () => {
  act(() => editor.addImages([file(), file()]));
  act(() => editor.editText("原来的草稿"));
  act(() => editor.removeImage(editor.draft.images[0].id));
  await render("other");
  act(() => editor.editText("另一条草稿"));
  await finish(readers[0]);
  await finish(readers[1]);
  expect(editor.draft).toEqual({ text: "另一条草稿", images: [] });
  await render();
  expect(editor.draft.text).toBe("原来的草稿");
  expect(editor.draft.images).toHaveLength(1);
  expect(editor.draft.images[0].url).toBe(imageUrl);
});

it("preserves attachments after failed sends and clears them after a successful retry", async () => {
  act(() => editor.addImages([file()]));
  await finish();
  vi.mocked(controller.send).mockResolvedValueOnce(false);
  await act(async () => editor.send());
  expect(editor.draft.images[0].url).toBe(imageUrl);
  await act(async () => editor.send());
  expect(editor.draft.images).toEqual([]);
});

it("limits attachment count and rejects unsupported, empty, or oversized files", async () => {
  const oversized = file();
  Object.defineProperty(oversized, "size", { value: MAX_IMAGE_BYTES + 1 });
  act(() => editor.addImages([oversized, new File([], "empty.png", { type: "image/png" }),
    new File(["svg"], "image.svg", { type: "image/svg+xml" })]));
  expect(editor.draft.images).toEqual([]);
  expect(controller.report).toHaveBeenCalled();
  act(() => editor.addImages(Array.from({ length: 9 }, file)));
  expect(editor.draft.images).toHaveLength(8);
  expect(readers).toHaveLength(8);
  act(() => editor.addImages([file()]));
  expect(editor.draft.images).toHaveLength(8);
});

it("removes failed reads so they do not leave the composer stuck", async () => {
  act(() => editor.addImages([file()]));
  await act(async () => readers[0].dispatchEvent(new ProgressEvent("error")));
  expect(editor.reading).toBe(false);
  expect(editor.draft.images).toEqual([]);
  expect(controller.report).toHaveBeenCalledWith("图片读取失败，请重新粘贴或选择图片。");
});
