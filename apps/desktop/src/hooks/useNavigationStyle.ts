import { useCallback, useState } from "react";

const NAVIGATION_STYLE_KEY = "codex-switch:navigation-style";
const SIDEBAR_COLLAPSED_KEY = "codex-switch:sidebar-collapsed";

export type NavigationStyle = "top" | "sidebar";

function loadNavigationStyle(): NavigationStyle {
  return window.localStorage.getItem(NAVIGATION_STYLE_KEY) === "top" ? "top" : "sidebar";
}

function loadSidebarCollapsed() {
  return window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "true";
}

export function useNavigationStyle() {
  const [style, setStyleState] = useState<NavigationStyle>(loadNavigationStyle);
  const [sidebarCollapsed, setSidebarCollapsedState] = useState(loadSidebarCollapsed);

  const setStyle = useCallback((nextStyle: NavigationStyle) => {
    window.localStorage.setItem(NAVIGATION_STYLE_KEY, nextStyle);
    setStyleState(nextStyle);
  }, []);

  const setSidebarCollapsed = useCallback((collapsed: boolean) => {
    window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(collapsed));
    setSidebarCollapsedState(collapsed);
  }, []);

  return { setSidebarCollapsed, setStyle, sidebarCollapsed, style };
}
