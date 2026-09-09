// @vitest-environment jsdom
import { act, useEffect, useSyncExternalStore } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { invoke } from "../../api/backend";
import { GuiController } from "./controller";
import { ModelPicker } from "./ModelPicker";
import { useUsageStatus } from "./useUsageStatus";
import type { Model } from "./types";

vi.mock("../../api/backend", () => ({ invoke: vi.fn(), isHostedWebApp: false, canManageCodexConnection: true }));
const models: Model[] = ["kimi-k3", "deepseek-v3"].map((model) => ({
  id: model, model, displayName: model, isDefault: true, defaultReasoningEffort: "high",
  supportedReasoningEfforts: [{ reasoningEffort: "high", description: "" }],
}));
let root: Root;
let container: HTMLDivElement;
let controller: GuiController;

function Fixture({ catalog }: { catalog: Model[] }) {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const { usage } = useUsageStatus(true);
  useEffect(() => { controller.setProviderModels(catalog); }, [catalog]);
  return <><span>{usage?.totalTokens ?? "刷新中"}</span><ModelPicker models={state.models}
    model={state.settings.model} effort={state.settings.effort} onChange={controller.settings} disabled={false} /></>;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false, addListener: vi.fn(), removeListener: vi.fn() })));
  localStorage.clear();
  controller = new GuiController();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  controller.dispose();
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("updates an open menu and accepts selections while usage polling waits for a response", async () => {
  const finish: ((value: unknown) => void)[] = [];
  vi.mocked(invoke).mockReset().mockImplementation(() => new Promise((resolve) => finish.push(resolve)));
  await act(async () => root.render(<Fixture catalog={[models[0]]} />));
  await act(async () => container.querySelector<HTMLButtonElement>("button")!.click());
  await act(async () => document.querySelector<HTMLButtonElement>('[aria-label="选择模型"]')!.click());
  expect(document.querySelector('[role="menu"]')?.textContent).toContain("kimi-k3");
  await act(async () => root.render(<Fixture catalog={[models[1]]} />));
  const menu = document.querySelector('[role="menu"]')!;
  expect(menu.textContent).toContain("deepseek-v3");
  expect(menu.textContent).not.toContain("kimi-k3");
  await act(async () => {
    await vi.advanceTimersByTimeAsync(15_000);
    menu.querySelectorAll<HTMLButtonElement>("button")[1].click();
  });
  expect(controller.getSnapshot().settings.model).toBe("deepseek-v3");
  expect(invoke).toHaveBeenCalledTimes(2);
  await act(async () => finish.forEach((resolve) => resolve({ totalTokens: 123, running: true })));
  expect(container.textContent).toContain("123");
  expect(controller.getSnapshot().settings.model).toBe("deepseek-v3");
});
