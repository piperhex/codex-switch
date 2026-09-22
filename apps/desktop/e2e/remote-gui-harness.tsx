import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { App, ConfigProvider } from 'antd';
import { ProxyAccountPicker } from '../src/pages/codexGui/ProxyAccountPicker';
import { useGuiComputers } from '../src/pages/codexGui/remote/useGuiComputers';
import RemoteGuiWorkspace from '../src/pages/codexGui/remote/RemoteGuiWorkspace';
import { DEMO_ACCOUNTS } from '../src/demo';

function Harness() {
  const [localDraft, setLocalDraft] = useState('Local unsent draft');
  const computers = useGuiComputers({ active: true, identity: { baseUrl: 'https://fixture.test', userId: 'owner' },
    login: () => {} });
  const device = computers.current;
  return <ConfigProvider><App><main style={{ height: '100vh' }}>
    {device && computers.identity ? <RemoteGuiWorkspace key={device.deviceId} active identity={computers.identity}
      device={device} computers={computers} privacyMode={false} focusMode={{ focused: false, onToggleFocus() {} }} />
      : <div className="local-workspace"><aside>
        <h3>本机会话</h3><div style={{ flex: 1 }} />
        <ProxyAccountPicker active privacyMode={false} computers={computers}
          accounts={[{ ...DEMO_ACCOUNTS[0], active: true }]} providers={[]} aggregateApis={[]} proxyRunning
          busy={false} loading={false} onSwitchAccount={async () => true} onSwitchProvider={async () => true} />
      </aside><textarea aria-label="本机草稿" value={localDraft} onChange={event => setLocalDraft(event.target.value)} /></div>}
  </main></App></ConfigProvider>;
}

const style = document.createElement('style');
style.textContent = `*{box-sizing:border-box}body{margin:0;font-family:Microsoft YaHei,sans-serif}
  :root{--ink:#233329;--panel:#fff;--bg:#f6f8f7;--line:#dfe6e1;--muted:#66796d;--green:#168348;
  --green-dark:#126a3b;--green-selection:#c6f4e8;--green-selection-hover:#e7f4ec}
  .local-workspace{display:flex;height:100%}.local-workspace aside{width:236px;flex-shrink:0;display:flex;flex-direction:column;
  background:var(--bg);padding:14px;--sidebar-inline-padding:14px;--sidebar-bottom-padding:14px}
  .local-workspace textarea{margin:20px;align-self:center;flex:1;min-width:0;padding:20px}
  .gui-remote-workspace[hidden]{display:none}`;
document.head.append(style);
createRoot(document.getElementById('root')!).render(<Harness />);
