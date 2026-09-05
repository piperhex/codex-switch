const AUTO_UPDATE_ENABLED_KEY = "codex-switch:auto-update-enabled";
const AUTO_UPDATE_CHANGED_EVENT = "codex-switch:auto-update-changed";

/** Controls installation on launch; background checks and downloads continue independently. */
export function isAutoUpdateEnabled(): boolean {
  try {
    return window.localStorage.getItem(AUTO_UPDATE_ENABLED_KEY) !== "false";
  } catch {
    // Do not install automatically when the saved preference cannot be read.
    return false;
  }
}

export function setAutoUpdateEnabled(enabled: boolean): void {
  window.localStorage.setItem(AUTO_UPDATE_ENABLED_KEY, String(enabled));
  window.dispatchEvent(new Event(AUTO_UPDATE_CHANGED_EVENT));
}

export function subscribeToAutoUpdatePreference(onChange: () => void): () => void {
  const onStorage = (event: StorageEvent) => {
    if (event.key === AUTO_UPDATE_ENABLED_KEY || event.key === null) onChange();
  };
  window.addEventListener(AUTO_UPDATE_CHANGED_EVENT, onChange);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(AUTO_UPDATE_CHANGED_EVENT, onChange);
    window.removeEventListener("storage", onStorage);
  };
}
