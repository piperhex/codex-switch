import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ChatProfileMenu } from '../src/chat/ChatProfileMenu';
import { createGuiToolsClient } from '../../../shared/remote-chat/guiTools';
import type { GuiAccountsClient } from '../../../shared/remote-chat/guiAccounts';
import '../src/styles.css';
import '../src/chat/chat.css';

const UPDATE_CHECK_DELAY_MS = 250;

const accounts: GuiAccountsClient = {
  read: async () => ({ selection: { kind: 'none' }, choices: [], running: true }),
  select: async selection => selection, subscribe: () => () => {},
};
function Harness() {
  const mode = new URLSearchParams(location.search).get('mode');
  const [connected, setConnected] = useState(mode !== 'offline');
  const [running, setRunning] = useState(mode === 'running');
  const [operations, setOperations] = useState<object[]>([]);
  const [tools] = useState(() => {
    let installed = mode === 'latest';
    let checked = false;
    let started = 0;
    let rejected = false;
    return createGuiToolsClient(async <T,>(body: object): Promise<T> => {
      const input = body as { operation: string };
      setOperations(previous => [...previous, input]);
      if (mode === 'unsupported') throw new Error('请更新远程电脑上的 Remote AI 后重试。');
      if (input.operation === 'guiCliRelease') {
        await new Promise(resolve => setTimeout(resolve, UPDATE_CHECK_DELAY_MS));
        checked = true;
        return { version: '0.156.0', size: installed ? 0 : 100 } as T;
      }
      if (input.operation === 'guiCliInstall') {
        if (mode === 'failure' && !rejected) {
          rejected = true; throw new Error('远程电脑上还有任务在运行，请等任务完成后再试。');
        }
        started = Date.now();
      }
      if (started && Date.now() - started > 1800) installed = true;
      const installing = !!started && !installed;
      const release = checked && !installed ? { version: '0.156.0', size: 100 } : null;
      return { version: installed ? '0.156.0' : '0.155.0', release, installing, error: '',
        progress: installing ? { downloaded: 50, total: 100, phase: 'downloading' } : null } as T;
    });
  });
  return <main className="chat-page" style={{ padding: 20 }}>
    <button onClick={() => setConnected(value => !value)}>切换连接</button>
    <button onClick={() => setRunning(value => !value)}>切换任务</button>
    <output data-testid="operations" hidden>{JSON.stringify(operations)}</output>
    <ChatProfileMenu client={accounts} guiTools={tools} ready={connected} running={running}
      deviceName="我的电脑" email="test@example.test" chooseDevice={() => {}} openTokenSummary={() => {}} />
  </main>;
}
createRoot(document.getElementById('root')!).render(<Harness />);
