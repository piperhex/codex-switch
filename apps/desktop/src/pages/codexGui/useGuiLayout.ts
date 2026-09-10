import { useEffect, useState } from "react";
import { isHostedWebApp } from "../../api/backend";
import "./responsive.less";

export function useGuiLayout(active: boolean) {
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    document.body.classList.toggle("codex-gui-focused", active && focused);
    return () => document.body.classList.remove("codex-gui-focused");
  }, [active, focused]);
  useEffect(() => {
    document.body.classList.toggle("codex-gui-active", active);
    if (isHostedWebApp) {
      const url = new URL(window.location.href);
      if (active) url.searchParams.set("page", "codexGui");
      else if (url.searchParams.get("page") === "codexGui") url.searchParams.delete("page");
      window.history.replaceState(null, "", url);
    }
    return () => document.body.classList.remove("codex-gui-active");
  }, [active]);
  return { focused, onToggleFocus: () => setFocused((value) => !value) };
}
