import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { App, Button, ConfigProvider, theme } from "antd";
import { GuiAutoSwitchSettingsDialog } from "../src/pages/codexGui/GuiAutoSwitchSettingsDialog";
import { useDreamSkin } from "../src/pages/codexGui/useDreamSkin";
import { publishDreamSkinStatus } from "../src/pages/dreamSkin/statusEvents";
import type { DreamSkinStatus } from "../src/types";
import styles from "../src/pages/codexGui/styles.module.less";
import "antd/dist/reset.css";
import "../src/styles.css";

const image = "/src-tauri/resources/dream-skin/presets/preset-rose-reverie/background.jpg";
const shared: DreamSkinStatus = { supported: true, platform: "windows", installed: false,
  runtimeInstalled: false, session: "notInstalled", activeThemeId: "shared",
  savedThemes: [{ id: "saved", name: "我的收藏皮肤" }] };
const calls: string[] = [];
const nativeFetch = window.fetch.bind(window);
window.fetch = async (input, init) => {
  if (!String(input).includes("/__codex_switch__/api/invoke")) return nativeFetch(input, init);
  const { command } = JSON.parse(String(init?.body)) as { command: string };
  calls.push(command);
  let result: unknown = {};
  if (command === "get_dream_skin_status") result = shared;
  if (command === "get_dream_skin_theme_preview") result = image;
  if (command === "get_dream_skin_resources_status") {
    await new Promise((resolve) => setTimeout(resolve, 250));
    result = { installed: true, phase: "ready", downloadedBytes: 0 };
  }
  if (command === "codex_gui_auto_switch_settings") result = { enabled: false, switchOnQuotaExhaustion: true,
    minimumRemainingPercent: 0, mode: "sequential", fallbackProviderId: null, accounts: [] };
  if (command === "get_dream_skin_market") result = { themes: [{ id: "market", name: "社区花园",
    description: "来自皮肤库的背景", previewUrl: image, tags: [], installed: false,
    updateAvailable: false, version: "1.0", author: "测试", license: "CC0" }] };
  if (command === "get_dream_skin_community_page") result = { items: [], total: 0, offset: 0 };
  return new Response(JSON.stringify({ ok: true, result }), { headers: { "Content-Type": "application/json" } });
};
Object.assign(window, { guiSkinFixture: { calls, pauseShared: () => {
  shared.installed = true; shared.session = "paused"; publishDreamSkinStatus(shared);
} } });

const dark = new URLSearchParams(location.search).has("dark");
document.documentElement.dataset.theme = dark ? "dark" : "light";
function Harness() {
  const [open, setOpen] = useState(true);
  const [beats, setBeats] = useState(0);
  const skin = useDreamSkin(true);
  useEffect(() => {
    const timer = setInterval(() => setBeats((value) => value + 1), 50);
    return () => clearInterval(timer);
  }, []);
  return <ConfigProvider theme={{ algorithm: dark ? theme.darkAlgorithm : theme.defaultAlgorithm }}><App>
    <div className={styles.page} style={{ ...skin, height: "100vh" }}
      data-dream-skin={skin ? "true" : undefined} aria-label="皮肤效果">
      <div className={styles.sidebar}><strong>Codex GUI</strong>
        <Button onClick={() => setOpen(true)}>打开设置</Button></div>
      <div style={{ padding: 32 }}><h2>今天想一起完成什么？</h2></div>
    </div>
    <output aria-label="刷新次数" hidden>{beats}</output>
    {open && <GuiAutoSwitchSettingsDialog accounts={[]} providers={[]} privacyMode={false}
      onClose={() => setOpen(false)} />}
  </App></ConfigProvider>;
}
createRoot(document.getElementById("root")!).render(<Harness />);
