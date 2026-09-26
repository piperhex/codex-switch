import { createRoot } from 'react-dom/client';
import { ChatTools } from '../src/chat/ChatTools';
import { client } from './remote-desktop-fixture';
import '../src/styles.css';

function Harness() {
  return <main style={{ padding: 24 }}><h1>电脑工具</h1>
    <ChatTools client={client} cwd="C:/workspace" active connected deviceName="Windows 测试电脑" />
  </main>;
}
createRoot(document.getElementById('root')!).render(<Harness />);
