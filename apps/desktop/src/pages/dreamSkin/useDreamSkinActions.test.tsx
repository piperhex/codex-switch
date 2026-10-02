// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useThemeActions } from "./useDreamSkinActions";
import type { DreamSkinStatus } from "../../types";

const confirm = vi.fn();
const runStatusOperation = vi.fn();
const refreshMarket = vi.fn();
const setCommunityThemes = vi.fn();
const setError = vi.fn();
const status: DreamSkinStatus = {
  supported: true, available: true, platform: "windows", installed: true,
  runtimeInstalled: true, session: "ready", restartRequired: true, savedThemes: [],
};
let root: Root;
let element: HTMLDivElement;

function SkinAction({ restartRequired }: { restartRequired: boolean }) {
  const actions = useThemeActions({
    confirmChatGptRestart: confirm, runStatusOperation, refreshMarket,
    setCommunityThemes, setError, status: { ...status, restartRequired }, t: (key) => key,
  });
  return <button onClick={() => actions.applyTheme("preset-rose-reverie")}>Apply</button>;
}

beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  element = document.createElement("div");
  root = createRoot(element);
});
afterEach(async () => { await act(async () => root.unmount()); });

it("requests a restart when returning to an installed skin after an ordinary launch", async () => {
  await act(async () => root.render(<SkinAction restartRequired />));
  await act(async () => element.querySelector("button")!.click());
  expect(confirm).toHaveBeenCalledOnce();
  expect(runStatusOperation).not.toHaveBeenCalled();
});

it("applies directly once a renderer channel is available again", async () => {
  await act(async () => root.render(<SkinAction restartRequired />));
  await act(async () => root.render(<SkinAction restartRequired={false} />));
  await act(async () => element.querySelector("button")!.click());
  expect(confirm).not.toHaveBeenCalled();
  expect(runStatusOperation).toHaveBeenCalledOnce();
});
