import { FloatingUsageBubble } from "./components/FloatingUsageBubble";
import { TokenUsageWindow } from "./components/TokenUsageWindow";
import { TotpWindow } from "./components/TotpWindow";
import { DashboardApp } from "./components/dashboard/DashboardApp";

function normalizeWindowName(value: string | null) {
  return (value ?? "").replace(/^#\/?/, "").split(/[?#]/)[0];
}

function currentWindowName() {
  const queryWindow = new URLSearchParams(window.location.search).get("window");
  return normalizeWindowName(queryWindow) || normalizeWindowName(window.location.hash);
}

export default function App() {
  const windowName = currentWindowName();
  if (windowName === "bubble") return <FloatingUsageBubble />;
  if (windowName === "token-usage") return <TokenUsageWindow />;
  if (windowName === "totp") return <TotpWindow />;
  return <DashboardApp />;
}
