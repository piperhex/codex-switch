import { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { ConfigProvider, Popover } from "antd";
import { Installer } from "../src/pages/codexGui/Installer";
import { useCliInstaller } from "../src/pages/codexGui/useCliInstaller";

function Harness() {
  const [active, setActive] = useState(true);
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const [beats, setBeats] = useState(0);
  const [connections, setConnections] = useState(0);
  const controller = useMemo(() => ({ connect: async () => { setConnections(value => value + 1); },
    clearError: () => setError(""), report: (reason: unknown) => setError(String(reason)) }), []);
  const installer = useCliInstaller(active, controller, true);
  useEffect(() => {
    const timer = setInterval(() => setBeats(value => value + 1), 50);
    return () => clearInterval(timer);
  }, []);
  return <ConfigProvider><main style={{ maxWidth: 640, margin: 40 }}>
    <button onClick={() => setActive(value => !value)}>{active ? "离开 GUI" : "进入 GUI"}</button>
    <p>连接次数：<output aria-label="连接次数">{connections}</output></p>
    <p>页面刷新：<output aria-label="页面刷新">{beats}</output></p>
    <p>当前版本：<output aria-label="当前版本">{installer.version}</output></p>
    <textarea aria-label="聊天输入" value={text} onChange={event => setText(event.target.value)} />
    <Popover trigger="click" styles={{ root: { maxWidth: 400 } }}
      content={<Installer installer={installer} compact />}><button>CLI 更新</button></Popover>
    {error && <p role="alert">{error}</p>}
  </main></ConfigProvider>;
}
createRoot(document.getElementById("root")!).render(<Harness />);
