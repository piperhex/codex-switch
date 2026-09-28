// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { loadDreamSkinStatus, loadDreamSkinThemePreview } from "../../api/backend";
import type { DreamSkinStatus } from "../../types";
import { publishDreamSkinStatus } from "../dreamSkin/statusEvents";
import { dreamSkinStyle, useDreamSkin } from "./useDreamSkin";
import { saveGuiTheme } from "./guiTheme";
import { saveGuiSkin } from "./guiSkin";

vi.mock("../../api/backend", () => ({ loadDreamSkinStatus: vi.fn(), loadDreamSkinThemePreview: vi.fn() }));
const status: DreamSkinStatus = { supported: true, platform: "windows", installed: true,
  runtimeInstalled: true, session: "active", activeThemeId: "first", activeThemeAppearance: "dark",
  activeThemeOverlayOpacity: 0.8, savedThemes: [] };
let root: Root;
let current: ReturnType<typeof useDreamSkin>;
function Fixture({ active = true }: { active?: boolean }) { current = useDreamSkin(active); return null; }

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.mocked(loadDreamSkinStatus).mockResolvedValue(status);
  vi.mocked(loadDreamSkinThemePreview).mockImplementation(async (id) => `data:image/png;base64,${id}`);
  root = createRoot(document.createElement("div"));
});
afterEach(async () => {
  await act(async () => root.unmount()); localStorage.clear(); vi.resetAllMocks(); vi.unstubAllGlobals();
});

it("preserves the background while giving explicit GUI appearance and color precedence", async () => {
  await act(async () => root.render(<Fixture />));
  await act(async () => { saveGuiTheme({ color: "#123456" }); });
  expect(current?.["--green-soft"]).toBeUndefined();
  expect(current?.colorScheme).toBe("dark");
  await act(async () => { saveGuiTheme({ mode: "light" }); });
  expect(current?.["--gui-skin-image"]).toContain("first");
  expect(current?.["--panel"]).toBeUndefined();
  expect(current?.colorScheme).toBeUndefined();
});

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

it("keeps the independent image and opacity when the shared skin changes or is disabled", async () => {
  saveGuiSkin({ mode: "custom", themeId: "preset-rose-reverie", overlayOpacity: 0.35 });
  await act(async () => root.render(<Fixture />));
  expect(loadDreamSkinStatus).not.toHaveBeenCalled();
  expect(current?.["--gui-skin-image"]).toContain("preset-rose-reverie");
  expect(current?.["--gui-skin-overlay"]).toBe("35%");
  await act(async () => publishDreamSkinStatus({ ...status, installed: false, session: "paused" }));
  expect(current?.["--gui-skin-image"]).toContain("preset-rose-reverie");
  await act(async () => { saveGuiSkin({ overlayOpacity: 0.5 }); });
  expect(current?.["--gui-skin-overlay"]).toBe("50%");
  expect(loadDreamSkinThemePreview).toHaveBeenCalledTimes(1);
  await act(async () => root.unmount());
  root = createRoot(document.createElement("div"));
  await act(async () => root.render(<Fixture />));
  expect(current?.["--gui-skin-image"]).toContain("preset-rose-reverie");
  expect(current?.["--gui-skin-overlay"]).toBe("50%");
});

it("can turn off the skin and resume either the saved choice or the shared skin", async () => {
  saveGuiSkin({ mode: "custom", themeId: "saved-skin" });
  await act(async () => root.render(<Fixture />));
  await act(async () => { saveGuiSkin({ mode: "none" }); });
  expect(current).toBeUndefined();
  await act(async () => publishDreamSkinStatus(status));
  expect(current).toBeUndefined();
  await act(async () => { saveGuiSkin({ mode: "custom" }); });
  expect(current?.["--gui-skin-image"]).toContain("saved-skin");
  await act(async () => { saveGuiSkin({ mode: "inherit" }); });
  expect(current?.["--gui-skin-image"]).toContain("first");
});

it("discards an outdated independent image and stays readable when the selected image is missing", async () => {
  let finish!: (image: string) => void;
  saveGuiSkin({ mode: "custom", themeId: "slow" });
  vi.mocked(loadDreamSkinThemePreview).mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
  await act(async () => root.render(<Fixture />));
  await act(async () => { saveGuiSkin({ themeId: "new" }); });
  await act(async () => finish("data:image/png;base64,old"));
  expect(current?.["--gui-skin-image"]).toContain("new");
  vi.mocked(loadDreamSkinThemePreview).mockRejectedValueOnce(new Error("missing"));
  await act(async () => { saveGuiSkin({ themeId: "missing" }); });
  expect(current).toBeUndefined();
});

it("accepts skin changes from another window and rejects invalid saved theme ids", async () => {
  await act(async () => root.render(<Fixture />));
  const changeStorage = async (value: string) => act(async () => {
    localStorage.setItem("codex-switch:gui-skin", value);
    window.dispatchEvent(new StorageEvent("storage", { key: "codex-switch:gui-skin" }));
  });
  await changeStorage('{"mode":"custom","themeId":"another-window","overlayOpacity":2}');
  expect(current?.["--gui-skin-image"]).toContain("another-window");
  expect(current?.["--gui-skin-overlay"]).toBe("100%");
  await changeStorage('{"mode":"custom","themeId":"../invalid"}');
  expect(current).toBeUndefined();
  expect(loadDreamSkinThemePreview).not.toHaveBeenCalledWith("../invalid");
  await changeStorage("invalid-json");
  expect(current?.["--gui-skin-image"]).toContain("first");
});
