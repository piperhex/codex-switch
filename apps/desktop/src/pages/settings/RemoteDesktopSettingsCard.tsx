import { useState } from 'react';
import { Button } from 'antd';
import { Monitor } from 'lucide-react';
import { isDesktopApp } from '../../api/backend';
import { RemoteDesktopSettingsModal } from './RemoteDesktopSettingsModal';

export function RemoteDesktopSettingsCard() {
  const [open, setOpen] = useState(false);
  if (!isDesktopApp) return null;
  return <>
    <section className="settings-card">
      <div className="settings-icon"><Monitor size={23} /></div>
      <div className="settings-card-content">
        <div className="settings-card-copy"><h3>远程桌面</h3>
          <p>管理其他设备访问这台电脑的权限。</p></div>
        <div className="settings-field">
          <Button onClick={() => setOpen(true)}>远程设置</Button>
        </div>
      </div>
    </section>
    <RemoteDesktopSettingsModal open={open} onClose={() => setOpen(false)} />
  </>;
}
