import { getCurrentWindow } from "@tauri-apps/api/window";
import { Minus, Square, X } from "lucide-react";
import type { Translate } from "../i18n";

export function WindowControls({ onError, t }: { onError: (message: string) => void; t: Translate }) {
  const run = (action: "minimize" | "toggleMaximize" | "close") => {
    void getCurrentWindow()[action]().catch((error: unknown) => onError(String(error)));
  };
  return (
    <div className="window-controls">
      <button type="button" className="window-control" aria-label={t("windowMenu.minimize")}
        onClick={() => run("minimize")}><Minus size={16} /></button>
      <button type="button" className="window-control" aria-label={t("windowMenu.maximize")}
        onClick={() => run("toggleMaximize")}><Square size={13} /></button>
      <button type="button" className="window-control window-control-close" aria-label={t("windowMenu.close")}
        onClick={() => run("close")}><X size={17} /></button>
    </div>
  );
}
