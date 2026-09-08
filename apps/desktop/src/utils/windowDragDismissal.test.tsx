// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Select } from "antd";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installWindowDragDismissal } from "./windowDragDismissal";

let container: HTMLDivElement;
let root: Root;
let cleanup: () => void;
const startDragging = vi.fn();

function nativeDragHandler(event: MouseEvent) {
  if (!(event.target instanceof Element) || !event.target.hasAttribute("data-tauri-drag-region")) return;
  if (event.button !== 0 || event.target.getAttribute("data-tauri-drag-region") === "false") return;
  event.preventDefault();
  event.stopImmediatePropagation();
  startDragging();
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  startDragging.mockClear();
  // The native drag listener is installed before application code in Tauri.
  document.addEventListener("mousedown", nativeDragHandler);
  cleanup = installWindowDragDismissal();
});

afterEach(async () => {
  cleanup();
  document.removeEventListener("mousedown", nativeDragHandler);
  await act(async () => root.unmount());
  container.remove();
});

async function mountSelect() {
  const onChange = vi.fn();
  await act(async () => root.render(<>
    <Select showSearch aria-label="Current login" defaultValue="unset" onChange={onChange}
      options={[{ value: "unset", label: "Not set" }, { value: "account", label: "Account" }]} />
    <div data-tauri-drag-region="true" className="drag-region" />
  </>));
  const input = container.querySelector<HTMLInputElement>('[role="combobox"]')!;
  await act(async () => {
    input.focus();
    input.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, detail: 1 }));
  });
  expect(input.getAttribute("aria-expanded")).toBe("true");
  return { input, onChange, dragRegion: container.querySelector<HTMLElement>(".drag-region")! };
}

async function press(target: Element, button = 0) {
  await act(async () => {
    target.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, detail: 1, button }));
  });
}

describe("window drag dropdown dismissal", () => {
  it("closes a focused Select before native dragging consumes mousedown without changing its value", async () => {
    const { input, onChange, dragRegion } = await mountSelect();
    await press(dragRegion);
    await vi.waitFor(() => expect(input.getAttribute("aria-expanded")).toBe("false"));
    expect(document.activeElement).not.toBe(input);
    expect(onChange).not.toHaveBeenCalled();
    expect(startDragging).toHaveBeenCalledOnce();
  });

  it("keeps option selection working", async () => {
    const { onChange } = await mountSelect();
    const option = document.querySelector<HTMLElement>('.ant-select-item-option[title="Account"]')!;
    await press(option);
    await act(async () => option.click());
    expect(onChange).toHaveBeenCalledWith("account", expect.objectContaining({ value: "account" }));
    expect(startDragging).not.toHaveBeenCalled();
  });

  it("does not blur for right clicks or disabled drag regions", async () => {
    const { input, dragRegion } = await mountSelect();
    await press(dragRegion, 2);
    expect(document.activeElement).toBe(input);
    dragRegion.setAttribute("data-tauri-drag-region", "false");
    await press(dragRegion);
    expect(document.activeElement).toBe(input);
    expect(startDragging).not.toHaveBeenCalled();
  });

  it("removes the capture listener on cleanup", async () => {
    const { input, dragRegion } = await mountSelect();
    cleanup();
    await press(dragRegion);
    expect(document.activeElement).toBe(input);
    expect(input.getAttribute("aria-expanded")).toBe("true");
    expect(startDragging).toHaveBeenCalledOnce();
  });
});
