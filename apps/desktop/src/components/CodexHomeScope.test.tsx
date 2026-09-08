// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CodexHomeScope, CodexHomeSelect, useSelectedCodexHome } from "./CodexHomeScope";
import { useCodexConfig } from "../pages/codexConfig/useCodexConfig";
import type { CodexConfigDocument } from "../api/codexConfig";

const backend = vi.hoisted(() => ({
  loadAppSettings: vi.fn(), read: vi.fn(), patch: vi.fn(), save: vi.fn(),
}));
vi.mock("../api/backend", () => ({ loadAppSettings: backend.loadAppSettings, hasLocalBackend: true }));
vi.mock("../api/codexConfig", () => ({
  readCodexConfigDocument: backend.read,
  patchCodexConfigDocument: backend.patch,
  saveCodexConfigDocument: backend.save,
}));

let container: HTMLDivElement;
let root: Root;
const homes = [
  { id: "default", path: "C:/codex", enabled: true },
  { id: "codex-gui", path: "C:/app/.codex", enabled: false },
];
const documentFor = (home: string): CodexConfigDocument => ({
  content: home, revision: `revision-${home}`, values: {}, error: null,
});

function Editor() {
  const homeId = useSelectedCodexHome();
  const config = useCodexConfig(true, homeId);
  const [selectedThread, selectThread] = useState(false);
  return <>
    <CodexHomeSelect />
    <output>{config.document?.content}</output>
    <button onClick={() => void config.commit(["model"], "edited")}>Save</button>
    <button onClick={() => selectThread(true)}>{selectedThread ? "Selected" : "Choose thread"}</button>
  </>;
}

beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  backend.loadAppSettings.mockResolvedValue({ codexHomes: homes });
  backend.read.mockImplementation(async (home: string) => documentFor(home));
  backend.patch.mockImplementation(async (_request: unknown, home: string) => documentFor(home));
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

async function chooseGui() {
  const input = container.querySelector<HTMLInputElement>("input[role=combobox]")!;
  await act(async () => input.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })));
  const option = [...document.querySelectorAll<HTMLElement>(".ant-select-item-option")]
    .find((item) => item.textContent?.includes("内置 Codex GUI"))!;
  await act(async () => option.click());
}

it("uses settings entries, allows a disabled sync home, and resets state when switching", async () => {
  await act(async () => root.render(<CodexHomeScope><Editor /></CodexHomeScope>));
  await act(async () => container.querySelectorAll("button")[1].click());
  await chooseGui();
  expect(container.querySelector("output")?.textContent).toBe("codex-gui");
  expect(container.textContent).toContain("Choose thread");
  await act(async () => container.querySelector("button")!.click());
  expect(backend.patch).toHaveBeenCalledWith({
    path: ["model"], value: "edited", expectedRevision: "revision-codex-gui",
  }, "codex-gui");
});

it("ignores a previous home's late read after switching", async () => {
  let finishOldRead!: (document: CodexConfigDocument) => void;
  backend.read.mockImplementation((home: string) => home === "default"
    ? new Promise<CodexConfigDocument>((resolve) => { finishOldRead = resolve; })
    : Promise.resolve(documentFor(home)));
  await act(async () => root.render(<CodexHomeScope><Editor /></CodexHomeScope>));
  await chooseGui();
  await act(async () => finishOldRead(documentFor("late-old-content")));
  expect(container.querySelector("output")?.textContent).toBe("codex-gui");
});

it("falls back to a saved home when the selected entry is removed", async () => {
  await act(async () => root.render(<CodexHomeScope><Editor /></CodexHomeScope>));
  await chooseGui();
  await act(async () => root.render(<CodexHomeScope active={false}><Editor /></CodexHomeScope>));
  backend.loadAppSettings.mockResolvedValue({ codexHomes: [homes[0]] });
  await act(async () => root.render(<CodexHomeScope><Editor /></CodexHomeScope>));
  expect(container.querySelector("output")?.textContent).toBe("default");
});
