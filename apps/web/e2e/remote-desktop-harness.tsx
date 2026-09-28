import { createRoot } from 'react-dom/client';
import { useState } from 'react';
import { ChatTools } from '../src/chat/ChatTools';
import { GuiToolbox } from '../../desktop/src/pages/codexGui/GuiToolbox';
import { client } from './remote-desktop-fixture';
import '../src/styles.css';

// Let a desktop browser inspect the mobile controls without changing production pointer detection.
if (new URLSearchParams(location.search).has('touch')) {
  const matchMedia = window.matchMedia.bind(window);
  window.matchMedia = query => {
    const media = matchMedia(query);
    if (query === '(any-pointer: fine)') Object.defineProperty(media, 'matches', { value: false });
    return media;
  };
}

function Harness() {
  const [connected, setConnected] = useState(true);
  return <main style={{ padding: 24 }}><h1>电脑工具</h1>
    <button id="disconnect-chat" onClick={() => setConnected(false)}>模拟聊天连接中断</button>
    {new URLSearchParams(location.search).has('native-clipboard')
      ? <GuiToolbox git={client.git} desktop={client.desktop} cwd="C:/workspace" active
        connected={connected} deviceName="Windows 测试电脑" />
      : <ChatTools client={client} cwd="C:/workspace" active connected={connected} deviceName="Windows 测试电脑" />}
  </main>;
}
createRoot(document.getElementById('root')!).render(<Harness />);
