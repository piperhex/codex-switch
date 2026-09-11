// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { useTerminalPanel, type TerminalPanelState } from "./useTerminalPanel";
import { terminalTheme } from "./theme";

it("preserves shells across hiding and project changes, and creates new tabs in the current project", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const root = createRoot(document.createElement("div"));
  let panel!: TerminalPanelState;
  function Fixture({ cwd }: { cwd: string }) { panel = useTerminalPanel(cwd); return null; }
  try {
    await act(async () => root.render(<Fixture cwd="D:/first" />));
    await act(async () => panel.toggle());
    const first = panel.tabs[0];
    await act(async () => panel.hide());
    expect(panel.open).toBe(false);
    expect(panel.tabs).toEqual([first]);
    await act(async () => root.render(<Fixture cwd="D:/second" />));
    await act(async () => panel.toggle());
    expect(panel.tabs).toEqual([first]);
    await act(async () => panel.add());
    expect(panel.tabs.map((tab) => tab.cwd)).toEqual(["D:/first", "D:/second"]);
    await act(async () => panel.remove(panel.selected));
    expect(panel.selected).toBe(first.id);
    await act(async () => panel.remove(first.id));
    expect(panel.open).toBe(false);
    expect(panel.tabs).toEqual([]);
  } finally { await act(async () => root.unmount()); vi.unstubAllGlobals(); }
});

it("uses opaque black in dark mode and white in light mode", () => {
  expect(terminalTheme(true).background).toBe("#000000");
  expect(terminalTheme(false).background).toBe("#ffffff");
});
