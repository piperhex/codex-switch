import { Profiler, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { App } from "antd";
import { Messages } from "../src/pages/codexGui/Messages";
import { AsyncQuestions } from "../src/pages/codexGui/AsyncQuestions";
import { TurnMessage } from "../src/pages/codexGui/TurnMessage";
import type { Conversation } from "../src/pages/codexGui/types";
import styles from "../src/pages/codexGui/styles.module.less";

const full = new URLSearchParams(location.search).has("full");
function Harness() {
  const [value, setValue] = useState<Conversation>();
  const [active, setActive] = useState(true);
  useEffect(() => { void fetch("/history-fixture.json").then((response) => response.json()).then(setValue); }, []);
  return <App><div style={{ height: "100vh", display: "flex", flexDirection: "column" }}>
    <nav><button onClick={() => setActive(!active)}>{active ? "离开对话" : "返回对话"}</button></nav>
    <main className={`${styles.page} ${styles.collapsed}`} style={{ flex: 1 }}>
      <div className={styles.workspace} hidden={!active}>
        <Profiler id="history" onRender={(_, __, duration) => {
          if (value) document.body.dataset.renderMs = String(Math.max(duration,
            Number(document.body.dataset.renderMs ?? 0)));
        }}>
          {full ? value?.turns.map((turn) => <TurnMessage key={turn.id} turn={turn} running={false} active={active} />)
            : <Messages selected={value?.thread.id ?? null} value={value} active={active}
              footer={<><AsyncQuestions value={value} onAnswer={async (item, answers) => {
                const response = await fetch("/async-answer", { method: "POST", body: JSON.stringify({ item, answers }) });
                return response.ok;
              }} /><input aria-label="消息" placeholder="输入消息…" style={{ padding: 12 }} /></>} />}
        </Profiler>
      </div>
    </main>
  </div></App>;
}

const css = document.createElement("style");
css.textContent = "*{box-sizing:border-box}body{margin:0;font-family:Microsoft YaHei,sans-serif}"
  + "[hidden]{display:none!important}:root{--ink:#233329;--panel:#fff;--line:#dfe6e1;"
  + "--muted:#66796d;--green:#168348;--green-dark:#126a3b;--green-soft:#e7f4ec}";
document.head.append(css);
createRoot(document.getElementById("root")!).render(<Harness />);
