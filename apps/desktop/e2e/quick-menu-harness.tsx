import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { mockIPC } from "@tauri-apps/api/mocks";
import { emit } from "@tauri-apps/api/event";
import { QuickMenu } from "../src/components/QuickMenu";
import type { MenuEntry } from "../src/components/QuickMenu/types";

const params = new URLSearchParams(location.search);
const delay = Number(params.get("delay") ?? 0);
const dark = params.has("dark");
localStorage.setItem("codex-switch:theme-mode", dark ? "dark" : "light");
document.documentElement.dataset.theme = dark ? "dark" : "light";
document.body.style.cssText = "margin:0;background:linear-gradient(135deg,#658591,#b7c5b8 45%,#e2c1a9);";
document.getElementById("root")!.style.cssText = "width:min(360px,100vw);height:100vh;margin:auto;";

const entry = (id: string, text: string, extra: Partial<MenuEntry> = {}): MenuEntry => ({
  id, text, enabled: true, checked: false, separator: false, children: [], ...extra,
});
const accounts = [
  ["cuddle2piper@gm…", "48%", "--"], ["fundsara76@mail…", "99%", "0%"],
  ["mlawrence293@ma…", "100%", "79%"], ["myers_stephanie…", "0%", "--"],
  ["qq601095001@gma…", "100%", "17%"], ["zh601095001@gma…", "100%", "--"],
];
const entries = [
  entry("tray:accounts-header", "账号", { enabled: false }),
  ...accounts.map(([name, primary, secondary], index) => entry(`tray:account:${index}`,
    `${name} · 主 ${primary} · 次 ${secondary}`, { checked: index === 0 })),
  entry("separator-1", "", { separator: true }),
  entry("tray:providers-header", "服务商", { enabled: false }),
  ...["127.0.0.1", "Remote AI", "DeepSeek", "Volcengine ModelArk", "ai.soulecho.cc", "ai.wulusai.com",
    "api.zetai.com", "tokenrhythm.studio", "xiuzhenzyxy.online"].map((name, index) =>
    entry(`tray:provider:${index}`, name, { checked: index === 1 })),
  entry("tray:provider-submenu:models", "模型服务", { children: [
    entry("tray:provider-model:one", "model-one", { checked: true }),
    entry("tray:provider-model:two", "model-two"),
  ] }),
  entry("tray:provider:disabled", "暂不可切换", { enabled: false }),
  entry("separator-2", "", { separator: true }),
  entry("tray:toggle-floating-bubble", "隐藏悬浮球 / 卡片"),
  entry("tray:settings", "设置"), entry("tray:dashboard", "仪表板"),
  entry("tray:restart-chatgpt", "重启 ChatGPT"), entry("tray:restart-app", "重启 Remote AI"),
  entry("tray:quit", "退出程序"),
];
let revision = 1;
let activeReads = 0;
let maxReads = 0;
let actionCount = 0;
mockIPC(async (command, payload) => {
  if (command === "quick_menu_snapshot") {
    maxReads = Math.max(maxReads, ++activeReads);
    await new Promise((resolve) => setTimeout(resolve, delay));
    activeReads--;
    document.body.dataset.maxReads = String(maxReads);
    return { revision, entries };
  }
  if (command === "quick_menu_present") document.body.dataset.present = JSON.stringify(payload);
  if (command === "quick_menu_dismiss") document.body.dataset.dismissed = "true";
  if (command === "quick_menu_activate") {
    document.body.dataset.action = JSON.stringify(payload);
    document.body.dataset.actionCount = String(++actionCount);
    await new Promise((resolve) => setTimeout(resolve, delay));
  }
}, { shouldMockEvents: true });
window.addEventListener("test-refresh", () => { revision++; void emit("quick-menu-refresh"); });
let beats = 0;
setInterval(() => { document.body.dataset.beats = String(++beats); }, 50);
createRoot(document.getElementById("root")!).render(<StrictMode><QuickMenu /></StrictMode>);
