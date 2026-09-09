// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { loadDreamSkinStatus, loadDreamSkinThemePreview } from "../../api/backend";
import type { DreamSkinStatus } from "../../types";
import { publishDreamSkinStatus } from "../dreamSkin/statusEvents";
import { dreamSkinStyle, useDreamSkin } from "./useDreamSkin";

vi.mock("../../api/backend", () => ({ loadDreamSkinStatus: vi.fn(), loadDreamSkinThemePreview: vi.fn() }));
const status: DreamSkinStatus = { supported: true, platform: "windows", installed: true,
  runtimeInstalled: true, session: "active", activeThemeId: "first", activeThemeAppearance: "dark",
  activeThemeOverlayOpacity: 0.8, savedThemes: [] };
let root: Root;
let current: ReturnType<typeof useDreamSkin>;
function Fixture({ active = true }: { active?: boolean }) { current = useDreamSkin(active); return null; }

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.mocked(loadDreamSkinStatus).mockResolvedValue(status);
  vi.mocked(loadDreamSkinThemePreview).mockImplementation(async (id) => `data:image/png;base64,${id}`);
  root = createRoot(document.createElement("div"));
});
afterEach(async () => { await act(async () => root.unmount()); vi.resetAllMocks(); vi.unstubAllGlobals(); });

it("loads the applied theme on entry and synchronizes opacity, pause, and restore", async () => {
  await act(async () => root.render(<Fixture />));
  expect(current?.["--gui-skin-image"]).toContain("first");
  expect(current?.["--gui-skin-overlay"]).toBe("80%");
  expect(current?.colorScheme).toBe("dark");
  await act(async () => publishDreamSkinStatus({ ...status, activeThemeOverlayOpacity: 0.35 }));
  expect(current?.["--gui-skin-overlay"]).toBe("35%");
  await act(async () => publishDreamSkinStatus({ ...status, session: "paused" }));
  expect(current).toBeUndefined();
  await act(async () => publishDreamSkinStatus(status));
  expect(current?.["--gui-skin-image"]).toContain("first");
  await act(async () => publishDreamSkinStatus({ ...status, installed: false }));
  expect(current).toBeUndefined();
});

it("ignores an old image response after a newer theme is applied", async () => {
  let finish!: (image: string) => void;
  vi.mocked(loadDreamSkinThemePreview).mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
  await act(async () => root.render(<Fixture />));
  await act(async () => publishDreamSkinStatus({ ...status, activeThemeId: "second" }));
  await act(async () => finish("data:image/png;base64,old"));
  expect(current?.["--gui-skin-image"]).toContain("second");
});

it("uses the ordinary theme on image failure and reloads when returning to the page", async () => {
  vi.mocked(loadDreamSkinThemePreview).mockRejectedValueOnce(new Error("unavailable"));
  await act(async () => root.render(<Fixture />));
  expect(current).toBeUndefined();
  await act(async () => root.render(<Fixture active={false} />));
  await act(async () => root.render(<Fixture />));
  expect(current?.["--gui-skin-image"]).toContain("first");
});

it("clamps the shared opacity and lets automatic appearance inherit the app theme", () => {
  const style = (opacity: number) => dreamSkinStyle({ image: "data:image/png;base64,test",
    status: { ...status, activeThemeAppearance: "auto", activeThemeOverlayOpacity: opacity } });
  expect(style(-1)?.["--gui-skin-overlay"]).toBe("0%");
  expect(style(2)?.["--gui-skin-overlay"]).toBe("100%");
  expect(style(NaN)?.["--gui-skin-overlay"]).toBe("80%");
  expect(style(0.5)?.colorScheme).toBeUndefined();
});
