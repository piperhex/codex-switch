// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ConfigProvider } from "antd";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ImageAttachments } from "./ImageAttachments";
import type { DraftImage } from "./useComposerDraft";

const images: DraftImage[] = [
  { id: "one", name: "第一张.png", url: "data:image/png;base64,b25l" },
  { id: "two", name: "第二张.png", url: "data:image/png;base64,dHdv" },
];
let root: Root;
let host: HTMLDivElement;
const removed = vi.fn();
const submitted = vi.fn();

function Fixture({ active = true, disabled = false, draftKey = "one" }: {
  active?: boolean; disabled?: boolean; draftKey?: string;
}) {
  const [attachments, setAttachments] = useState(images);
  return <ConfigProvider theme={{ token: { motion: false } }}><form onSubmit={(event) => {
    event.preventDefault(); submitted();
  }}>
    <textarea defaultValue="尚未发送的内容" />
    <ImageAttachments key={draftKey} images={attachments} active={active} disabled={disabled} onRemove={(id) => {
      removed(id); setAttachments((values) => values.filter((image) => image.id !== id));
    }} />
  </form></ConfigProvider>;
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.clearAllMocks();
  const getStyle = window.getComputedStyle;
  // jsdom does not implement pseudo-element styles used by the modal scrollbar measurement.
  vi.spyOn(window, "getComputedStyle").mockImplementation((element) => getStyle(element));
  host = document.createElement("div"); document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals();
});
const render = (props: Parameters<typeof Fixture>[0] = {}) => act(async () => root.render(<Fixture {...props} />));
const click = (label: string) => act(async () => host.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)!.click());
const dialog = () => document.querySelector('[role="dialog"]');

it("opens the selected full-size image and closes with Escape without changing or sending the draft", async () => {
  await render();
  await click("放大查看：图片 2");
  expect(dialog()?.querySelector("img")?.getAttribute("src")).toBe(images[1].url);
  await act(async () => { dialog()!.dispatchEvent(new KeyboardEvent("keydown", {
    key: "Escape", keyCode: 27, bubbles: true,
  })); });
  expect(dialog()).toBeNull();
  expect(host.querySelector("textarea")?.value).toBe("尚未发送的内容");
  expect(host.querySelectorAll("img")).toHaveLength(2);
  expect(removed).not.toHaveBeenCalled(); expect(submitted).not.toHaveBeenCalled();
});

it("keeps removal separate from preview and still allows preview while sending", async () => {
  await render({ disabled: true });
  await click("移除图片 1");
  expect(removed).not.toHaveBeenCalled();
  await click("放大查看：图片 1");
  expect(dialog()).not.toBeNull();
  await act(async () => document.querySelector<HTMLButtonElement>('[aria-label="Close"]')!.click());
  await render();
  await click("移除图片 1");
  expect(removed).toHaveBeenCalledWith("one");
  expect(host.querySelectorAll("img")).toHaveLength(1);
  expect(dialog()).toBeNull(); expect(submitted).not.toHaveBeenCalled();
});

it("closes previews when leaving the page or switching drafts", async () => {
  await render(); await click("放大查看：图片 1");
  await render({ active: false });
  expect(dialog()).toBeNull();
  await render(); expect(dialog()).toBeNull();
  await click("放大查看：图片 1");
  await render({ draftKey: "other" });
  expect(dialog()).toBeNull();
});
