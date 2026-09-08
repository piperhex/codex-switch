// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { isTauri } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { message } from "antd";
import { MessageLink } from "./MessageLink";

vi.mock("@tauri-apps/api/core", () => ({ isTauri: vi.fn(() => false) }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));
vi.mock("antd", () => ({ message: { error: vi.fn() } }));
let root: Root;
let container: HTMLDivElement;
const href = "https://example.com/photo-source";

beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.mocked(isTauri).mockReturnValue(false);
  vi.mocked(openUrl).mockResolvedValue(undefined);
  container = document.createElement("div");
  root = createRoot(container);
  await act(async () => root.render(<MessageLink href={href}>图片来源</MessageLink>));
});

afterEach(async () => {
  await act(async () => root.unmount());
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

it.each([false, true])("preserves browser navigation with Ctrl-click=%s", async (ctrlKey) => {
  const link = container.querySelector("a")!;
  const event = new MouseEvent("click", { bubbles: true, cancelable: true, ctrlKey });
  await act(async () => link.dispatchEvent(event));
  expect(event.defaultPrevented).toBe(false);
  expect(link.href).toBe(href);
  expect(link.target).toBe("_blank");
  expect(link.rel).toBe("noopener noreferrer");
  expect(openUrl).not.toHaveBeenCalled();
});

it("uses the desktop opener inside Tauri", async () => {
  vi.mocked(isTauri).mockReturnValue(true);
  const event = new MouseEvent("click", { bubbles: true, cancelable: true });
  await act(async () => container.querySelector("a")!.dispatchEvent(event));
  expect(event.defaultPrevented).toBe(true);
  expect(openUrl).toHaveBeenCalledWith(href);
});

it("handles a desktop opener failure with a compact message", async () => {
  vi.mocked(isTauri).mockReturnValue(true);
  vi.mocked(openUrl).mockRejectedValue(new Error("Internal failure"));
  await act(async () => container.querySelector("a")!.click());
  expect(message.error).toHaveBeenCalledWith({ content: "链接暂时无法打开，请稍后重试。",
    style: { maxWidth: 400, marginInline: "auto" } });
});

it.each(["javascript:alert(1)", "/__codex_switch__/api/invoke", undefined])(
  "does not navigate unsupported destinations: %s", async (destination) => {
    await act(async () => root.render(<MessageLink href={destination}>链接</MessageLink>));
    expect(container.querySelector("a")).toBeNull();
    expect(container.textContent).toBe("链接");
  },
);
