import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { ConfigProvider } from "antd";
import { ProxySessionManager } from "../src/components/ProxySessionManager";
import { useAccountDashboard } from "../src/hooks/useAccountDashboard";
import { MessageItem } from "../src/pages/codexGui/MessageItem";
import { translate, type Translate } from "../src/i18n";
import "antd/dist/reset.css";
import "../src/styles.css";

const paragraph = "A status update with **important details**, `sampleCode`, and a short explanation.\n\n";
const longReply = paragraph.repeat(1_200);
const t: Translate = (key, values) => translate("zh", key, values);
const notify = (message: string) => console.warn(message);

function Harness() {
  const dashboard = useAccountDashboard(notify);
  const [streaming, setStreaming] = useState(false);
  const [text, setText] = useState("");
  const [clicks, setClicks] = useState(0);
  const [sessions, setSessions] = useState(true);
  const reply = useRef<HTMLDivElement>(null);
  useEffect(() => { void dashboard.reload(); }, [dashboard.reload]);
  useEffect(() => {
    if (!streaming) return;
    const timer = setInterval(() => setText(current => current + " streamed"), 25);
    return () => clearInterval(timer);
  }, [streaming]);
  useEffect(() => {
    const node = reply.current!;
    let updates = 0;
    const observer = new MutationObserver(() => { node.dataset.updates = String(++updates); });
    observer.observe(node, { subtree: true, childList: true, characterData: true });
    return () => observer.disconnect();
  }, []);
  return <ConfigProvider theme={{ token: { motion: false } }}>
    <main style={{ padding: 20 }}>
      <div style={{ display: "flex", gap: 12, marginBottom: 16 }}>
        <button onClick={() => { setText(longReply); setStreaming(true); }}>Start stream</button>
        <button onClick={() => { setText(current => current + "\n\nSTREAM_COMPLETED"); setStreaming(false); }}>
          Stop stream
        </button>
        <button onClick={() => setClicks(value => value + 1)}>Click {clicks}</button>
        <button onClick={() => setSessions(value => !value)}>Toggle sessions</button>
        <button onClick={() => { for (let index = 0; index < 40; index++) void dashboard.reload(); }}>
          Refresh burst
        </button>
        <input aria-label="Draft" />
      </div>
      <output aria-label="Received characters">{text.length}</output>
      <output aria-label="Accounts loading">{String(dashboard.loading)}</output>
      {sessions && <div style={{ height: 260 }}><ProxySessionManager t={t} /></div>}
      <div ref={reply} data-reply style={{ height: 350, overflow: "auto", marginTop: 20 }}>
        <MessageItem item={{ id: "reply", type: "agentMessage", text, phase: "final_answer" }} streaming={streaming} />
      </div>
    </main>
  </ConfigProvider>;
}

createRoot(document.getElementById("root")!).render(<Harness />);
