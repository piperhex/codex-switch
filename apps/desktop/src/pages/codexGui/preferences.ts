import type { GuiState, Settings } from "./types";

const STORAGE_KEY = "codex-switch:gui";
const DEFAULT_SETTINGS: Settings = { cwd: "", model: "", effort: "", access: "workspace-write" };

export function initialState(): GuiState {
  let settings = DEFAULT_SETTINGS;
  let pins: string[] = [];
  let projects: string[] = [];
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
    const saved = parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : {};
    settings = { ...DEFAULT_SETTINGS, cwd: typeof saved.cwd === "string" ? saved.cwd : "" };
    pins = Array.isArray(saved.pins) ? saved.pins.filter((v: unknown) => typeof v === "string") : [];
    projects = Array.isArray(saved.projects) ? saved.projects.filter((v: unknown) => typeof v === "string") : [];
  } catch { /* Preferences are optional; corrupted or unavailable storage uses defaults. */ }
  return { connection: "offline", threads: [], conversations: {}, selected: null, models: [], approvals: [],
    settings, loading: false, sending: false, archived: false, search: "", cursor: null, error: "", pins, projects };
}

export function savePreferences(state: GuiState) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ cwd: state.settings.cwd,
      pins: state.pins, projects: state.projects }));
  } catch { /* A storage failure must not prevent an in-memory conversation. */ }
}
