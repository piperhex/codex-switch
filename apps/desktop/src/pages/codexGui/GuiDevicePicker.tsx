import { useRef, useState } from 'react';
import { Popover, Spin } from 'antd';
import { Check, ChevronDown, Monitor, RefreshCw } from 'lucide-react';
import type { GuiComputerNavigation } from './remote/types';
import styles from './ProxyAccountPicker.module.less';

function DeviceList({ navigation, busy, choose }: {
  navigation: GuiComputerNavigation; busy: boolean; choose: (device: GuiComputerNavigation['current']) => void;
}) {
  return <section className={styles.deviceList} aria-label="设备列表" aria-busy={navigation.loading}>
    <button type="button" className={styles.deviceOption} disabled={busy}
      aria-pressed={!navigation.current} onClick={() => choose(null)}>
      <Monitor size={16} /><span>本机</span>{!navigation.current && <Check size={16} />}
    </button>
    {navigation.devices.map((device) => <button key={device.deviceId} type="button"
      className={styles.deviceOption} aria-pressed={navigation.current?.deviceId === device.deviceId}
      disabled={busy || !device.online} onClick={() => choose(device)}>
      <Monitor size={16} /><span><span className={styles.deviceName}>{device.name}</span>
        <small>{device.online ? '在线' : '离线'} · {device.platform}</small></span>
      {navigation.current?.deviceId === device.deviceId && <Check size={16} />}
    </button>)}
  </section>;
}

export function GuiDevicePicker({ navigation, busy, onSelect }: {
  navigation: GuiComputerNavigation; busy: boolean; onSelect: () => void;
}) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const close = () => { setOpen(false); trigger.current?.focus(); };
  const choose = (device: GuiComputerNavigation['current']) => {
    if (busy) return;
    navigation.choose(device); setOpen(false); onSelect();
  };
  const content = <div className={styles.devicePanel} onKeyDown={(event) => {
    if (event.key === 'Escape') { event.stopPropagation(); close(); }
  }}>
    <DeviceList navigation={navigation} busy={busy} choose={choose} />
    <div className={styles.deviceFooter}>
      {!navigation.authenticated ? <button type="button" className={styles.deviceOption}
        disabled={busy} onClick={() => { close(); onSelect(); navigation.login(); }}>登录后选择其他设备</button> : <>
        {!navigation.devices.length && !navigation.loading && !navigation.error
          && <p className={styles.hint}>在其他设备上打开 Codex Switch，登录同一账户即可连接。</p>}
        <button type="button" className={styles.deviceOption} aria-label="刷新设备列表"
          disabled={navigation.loading} onClick={navigation.refresh}>
          {navigation.loading ? <Spin size="small" /> : <RefreshCw size={14} />}刷新设备列表</button>
      </>}
      {navigation.error && <p className={styles.error} role="alert">{navigation.error}</p>}
    </div>
  </div>;
  return <Popover trigger="click" placement="bottomRight" arrow={false} open={open} content={content}
    classNames={{ root: styles.devicePopup }} getPopupContainer={(element) => element.parentElement ?? document.body}
    onOpenChange={(next) => { setOpen(next); if (next) navigation.refresh(); }}>
    <button ref={trigger} type="button" className={styles.deviceTrigger} aria-label="切换设备"
      aria-expanded={open} title={`当前设备：${navigation.current?.name ?? '本机'}`} onKeyDown={(event) => {
        if (open && event.key === 'Escape') { event.stopPropagation(); close(); }
      }}>
      <Monitor size={16} /><span>切换设备</span><ChevronDown size={12} />
    </button>
  </Popover>;
}
