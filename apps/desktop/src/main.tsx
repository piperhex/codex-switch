import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { refreshTokenCostPresetsOnce, subscribeToTokenCostPresetStorage } from "./utils/tokenCostPresetStartup";
import { RemoteChatHost } from "./remoteChat/useChatHost";
import { applyThemeMode, loadThemeMode } from "./utils/themeMode";
import "antd/dist/reset.css";
import "./styles.css";

applyThemeMode(loadThemeMode());

function normalizeWindowRoute(value: string | null) {
  return (value ?? "").replace(/^#\/?/, "").split(/[?#]/)[0];
}

function windowRoute() {
  const queryWindow = normalizeWindowRoute(new URLSearchParams(window.location.search).get("window"));
  const hashWindow = normalizeWindowRoute(window.location.hash);
  return queryWindow || hashWindow;
}

const currentWindowRoute = windowRoute();
const stopPresetStorage = subscribeToTokenCostPresetStorage();
if (!currentWindowRoute && '__TAURI_INTERNALS__' in window) void refreshTokenCostPresetsOnce();
if (import.meta.hot) import.meta.hot.dispose(stopPresetStorage);
document.documentElement.classList.toggle("floating-usage-page", currentWindowRoute === "bubble");
document.documentElement.classList.toggle("token-usage-page", currentWindowRoute === "token-usage");
document.documentElement.classList.toggle("totp-window-page", currentWindowRoute === "totp");

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {!currentWindowRoute && '__TAURI_INTERNALS__' in window && <RemoteChatHost />}
    <App />
  </React.StrictMode>,
);
