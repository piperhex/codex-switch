import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { App, ConfigProvider } from "antd";
import { Messages } from "../src/pages/codexGui/Messages";
import type { Conversation, Item } from "../src/pages/codexGui/types";
import styles from "../src/pages/codexGui/styles.module.less";

const MESSAGE_COUNT = 2_000;
const ITEMS_PER_TURN = 20;
const TICK_MS = 50;
const message = (index: number): Item => index % 2 === 0
  ? { id: `message-${index}`, type: "userMessage", content: [{ type: "text", text: `请检查第 ${index} 项。` }] }
  : { id: `message-${index}`, type: "agentMessage", phase: "final_answer",
    text: `### 检查结果 ${index}\n\n这是一条包含格式和代码的历史回复。\n\n`
      + `\`\`\`typescript\nconst result = ${index};\nconsole.log(result);\n\`\`\`\n\n已完成检查，可以继续。` };
const large: Conversation = { thread: { id: "large", cwd: "", preview: "长对话", updatedAt: 1 },
  activeTurn: null, tokens: 0, error: "", turns: Array.from({ length: MESSAGE_COUNT / ITEMS_PER_TURN }, (_, turn) => ({
    id: `turn-${turn}`, status: "completed", items: Array.from({ length: ITEMS_PER_TURN },
      (_, index) => message(turn * ITEMS_PER_TURN + index)),
  })) };
const compact: Conversation = { ...large, turns: [{ id: "compact", status: "completed", items: [
  message(0),
  ...Array.from({ length: 30 }, (_, index): Item => ({ id: `activity-${index}`, type: "agentMessage",
    phase: "commentary", text: `正在检查第 ${index} 项。` })),
  { id: "final", type: "agentMessage", phase: "final_answer", text: "最新回复已完成。" },
] }] };
const cached = new URLSearchParams(location.search).has("compact") ? compact : large;
const other: Conversation = { ...cached, thread: { ...cached.thread, id: "other" }, turns: [] };

function Harness() {
  const [value, setValue] = useState(cached);
  const [selected, setSelected] = useState("large");
  const [active, setActive] = useState(true);
  const [streaming, setStreaming] = useState(false);
  const [beats, setBeats] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setBeats((count) => count + 1), TICK_MS);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (!streaming) return;
    const startedAt = Date.now() / 1_000;
    let count = 0;
    const timer = setInterval(() => {
      count++;
      setValue({ ...cached, activeTurn: "stream", turns: [...cached.turns, {
        id: "stream", status: "inProgress", startedAt,
        items: [{ id: "live", type: "agentMessage", phase: "final_answer", text: `实时回复 ${count}` }],
      }] });
    }, TICK_MS);
    return () => clearInterval(timer);
  }, [streaming]);
  return <ConfigProvider><App>
    <div style={{ height: "100vh", display: "flex", flexDirection: "column" }}>
      <nav style={{ padding: 12, display: "flex", gap: 12 }}>
        <button onClick={() => setSelected(selected === "large" ? "other" : "large")}>切换会话</button>
        <button onClick={() => setActive(!active)}>{active ? "离开对话" : "返回对话"}</button>
        <button onClick={() => setStreaming(!streaming)}>{streaming ? "暂停回复" : "开始回复"}</button>
        <output aria-label="刷新次数">{beats}</output>
      </nav>
      <main className={`${styles.page} ${styles.collapsed}`} style={{ flex: 1 }}>
        <div className={styles.workspace} hidden={!active}>
          <Messages selected={selected} value={selected === "large" ? value : other} active={active}
            footer={<div className={styles.composerWrap}><div className={styles.composer}>
              <input aria-label="消息" placeholder="输入消息…" style={{ width: "95%", padding: 12 }} />
            </div></div>} />
        </div>
      </main>
    </div>
  </App></ConfigProvider>;
}

const css = document.createElement("style");
css.textContent = "*{box-sizing:border-box}body{margin:0;font-family:Microsoft YaHei,sans-serif}"
  + "[hidden]{display:none!important}:root{--ink:#233329;--panel:#fff;--line:#dfe6e1;"
  + "--muted:#66796d;--green:#168348;--green-dark:#126a3b;--green-soft:#e7f4ec}";
document.head.append(css);
createRoot(document.getElementById("root")!).render(<Harness />);
