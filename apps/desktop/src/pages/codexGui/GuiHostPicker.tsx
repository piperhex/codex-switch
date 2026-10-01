import { guiText } from "../../i18n/guiText";
import { useEffect, useRef, useState } from 'react';
import { Input, Popover, Spin, type InputRef } from 'antd';
import { Check, ChevronDown, Laptop, Monitor, RefreshCw, Search } from 'lucide-react';
import type { GuiComputerNavigation } from './remote/types';
import projectStyles from './ProjectPicker.module.less';
import styles from './GuiHostPicker.module.less';

export function GuiHostPicker({ navigation, active }: { navigation: GuiComputerNavigation; active: boolean }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const trigger = useRef<HTMLButtonElement>(null);
  const search = useRef<InputRef>(null);
  const list = useRef<HTMLDivElement>(null);
  const currentId = navigation.current?.deviceId;
  const label = navigation.current?.name ?? guiText("本地");
  const keyword = query.trim().toLocaleLowerCase();
  const devices = navigation.devices.filter(device => device.name.toLocaleLowerCase().includes(keyword));
  const showLocal = guiText("本地").includes(keyword);
  useEffect(() => { setOpen(false); }, [active, currentId]);
  const close = () => { setOpen(false); trigger.current?.focus(); };
  const choose = (device: GuiComputerNavigation['current']) => {
    if (!active || (device && !device.online)) return;
    close(); navigation.choose(device);
  };
  const panel = <div className={projectStyles.panel} onKeyDown={event => {
    if (event.key === 'Escape') { event.stopPropagation(); close(); }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    const options = Array.from(list.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? []);
    const current = options.indexOf(document.activeElement as HTMLButtonElement);
    const next = current + (event.key === 'ArrowDown' ? 1 : -1);
    event.preventDefault();
    if (next < 0 || next >= options.length) search.current?.focus();
    else options[next]?.focus();
  }}>
    <Input ref={search} variant="borderless" className={projectStyles.search} prefix={<Search size={16} />}
      aria-label={guiText("搜索主机")} placeholder={guiText("搜索主机")} value={query} onChange={event => setQuery(event.target.value)} />
    <div ref={list} className={`${projectStyles.list} ${styles.list}`} role="menu"
      aria-label={guiText("主机列表")} aria-busy={navigation.loading}>
      {showLocal && <button type="button" role="menuitemradio" aria-checked={!currentId}
        className={projectStyles.option} onClick={() => choose(null)}>
        <Laptop size={18} /><span className={styles.deviceName}>{guiText("本地")}</span>{!currentId && <Check size={16} />}
      </button>}
      {devices.map(device => <button key={device.deviceId} type="button" role="menuitemradio"
        aria-checked={currentId === device.deviceId} disabled={!device.online}
        className={projectStyles.option} onClick={() => choose(device)}>
        <Monitor size={18} /><span className={styles.deviceName}>{device.name}
          <small className={device.online ? styles.online : undefined}>{device.online ? guiText("在线") : guiText("离线")}</small>
        </span>{currentId === device.deviceId && <Check size={16} />}
      </button>)}
      {!showLocal && !devices.length && <p className={projectStyles.empty}>{guiText("没有找到匹配的主机")}</p>}
    </div>
    <div className={projectStyles.divider} />
    {!navigation.authenticated ? <button type="button" className={projectStyles.option}
      onClick={() => { close(); navigation.login(); }}>{guiText("登录后选择其他主机")}</button> : <>
      {!navigation.devices.length && !navigation.loading && !navigation.error
        && <p className={projectStyles.empty}>{guiText("在其他主机上打开 Remote AI，登录同一账户即可连接。")}</p>}
      <button type="button" className={projectStyles.option} disabled={navigation.loading}
        aria-label={guiText("刷新主机列表")} onClick={navigation.refresh}>
        {navigation.loading ? <Spin size="small" /> : <RefreshCw size={16} />}
        <span>{navigation.loading ? guiText("正在查找主机…") : guiText("刷新主机列表")}</span>
      </button>
    </>}
    {navigation.error && <p className={`${projectStyles.empty} ${styles.error}`} role="alert">{navigation.error}</p>}
  </div>;
  return <Popover trigger="click" placement="topRight" arrow={false} open={open && active} content={panel}
    onOpenChange={next => { setOpen(next); if (next) { setQuery(''); navigation.refresh(); } }}
    afterOpenChange={next => { if (next) search.current?.focus(); }}
    styles={{ root: { maxWidth: 400 }, body: { padding: 0, borderRadius: 20, overflow: 'hidden' } }}>
    <button ref={trigger} type="button" className={`${projectStyles.name} ${styles.trigger}`}
      aria-label={guiText("切换主机：{value1}", { value1: label })} aria-haspopup="menu" aria-expanded={open && active}>
      {currentId ? <Monitor size={16} /> : <Laptop size={16} />}<span>{label}</span><ChevronDown size={13} />
    </button>
  </Popover>;
}
