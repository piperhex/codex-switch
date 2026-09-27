import { createRoot } from 'react-dom/client';
import { useState } from 'react';
import { ChatTools } from '../src/chat/ChatTools';
import { client } from './remote-desktop-fixture';
import '../src/styles.css';

function Harness() {
  const [connected, setConnected] = useState(true);
  return <main style={{ padding: 24 }}><h1>电脑工具</h1>
    <button id="disconnect-chat" onClick={() => setConnected(false)}>模拟聊天连接中断</button>
    <ChatTools client={client} cwd="C:/workspace" active connected={connected} deviceName="Windows 测试电脑" />
  </main>;
}
createRoot(document.getElementById('root')!).render(<Harness />);
