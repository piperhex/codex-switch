import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { Popover, Spin } from 'antd';
import { ArrowLeft, Check, ChevronRight, ChevronsUpDown, Monitor, RefreshCw, UserRound } from 'lucide-react';
import type { GuiComputerNavigation } from './remote/types';
import { MAX_ACCOUNT_PICKER_WIDTH, useAccountPickerWidth } from './useAccountPickerWidth';
import styles from './ProxyAccountPicker.module.less';

interface Props {
  active: boolean; open: boolean; onOpenChange: (open: boolean) => void;
  trigger: RefObject<HTMLButtonElement>; name: string; icon: ReactNode; summary: ReactNode; accounts: ReactNode;
  computers?: GuiComputerNavigation; busy?: boolean; onOpenAccounts?: () => void;
}

function ComputerList({ navigation, close, busy }: {
  navigation: GuiComputerNavigation; close: () => void; busy: boolean;
}) {
  const choose = (device: GuiComputerNavigation['current']) => { navigation.choose(device); close(); };
  return <>
    <div className={styles.list} aria-busy={navigation.loading}>
      <section className={styles.group} aria-label="电脑列表">
        <button type="button" className={`${styles.option} ${!navigation.current ? styles.selected : ''}`}
          disabled={busy} aria-pressed={!navigation.current} onClick={() => choose(null)}>
          <Monitor size={16} /><span>本机</span>{!navigation.current && <Check size={15} />}
        </button>
        {navigation.devices.map((device) => <button key={device.deviceId} type="button"
          className={`${styles.option} ${navigation.current?.deviceId === device.deviceId ? styles.selected : ''}`}
          aria-pressed={navigation.current?.deviceId === device.deviceId} disabled={busy || !device.online}
          onClick={() => choose(device)}><Monitor size={16} /><span>
            <span className={styles.optionName}>{device.name}</span>
            <small>{device.online ? '在线' : '离线'} · {device.platform}</small>
          </span>{navigation.current?.deviceId === device.deviceId && <Check size={15} />}</button>)}
      </section>
    </div>
    <div className={styles.footer}>
      {!navigation.authenticated ? <button type="button" className={styles.option}
        onClick={() => { close(); navigation.login(); }}>登录后选择其他电脑</button> : <>
        {!navigation.devices.length && !navigation.loading && !navigation.error
          && <p className={styles.hint}>在其他电脑上打开 Codex Switch，登录同一账户即可连接。</p>}
        <button type="button" className={styles.option} aria-label="刷新电脑列表"
          disabled={navigation.loading} onClick={navigation.refresh}>
          {navigation.loading ? <Spin size="small" /> : <RefreshCw size={14} />}刷新电脑列表</button>
      </>}
      {navigation.error && <p className={styles.error} role="alert">{navigation.error}</p>}
    </div>
  </>;
}

/** Both local and remote account lists use the same two-level computer/account menu. */
export function GuiAccountMenu(props: Props) {
  const [screen, setScreen] = useState<'home' | 'computers' | 'accounts'>('home');
  const content = useRef<HTMLDivElement>(null);
  const width = useAccountPickerWidth(props.trigger, props.active);
  const computers = props.computers;
  const computerName = computers?.current?.name ?? '本机';
  useEffect(() => { if (!props.open) setScreen('home'); }, [props.open]);
  useEffect(() => {
    if (props.open && screen !== 'home') content.current?.querySelector<HTMLButtonElement>('button')?.focus();
  }, [screen, props.open]);
  const close = () => { props.onOpenChange(false); props.trigger.current?.focus(); };
  const accounts = !computers || screen === 'accounts';
  const panel = <div ref={content} className={styles.panel} onKeyDown={(event) => {
    if (event.key === 'Escape') { event.stopPropagation(); close(); }
    if (event.key === 'ArrowLeft' && computers && event.target instanceof HTMLButtonElement) {
      event.stopPropagation(); setScreen('home');
    }
  }}>
    {computers && screen !== 'home' && <div className={styles.submenuHeader}>
      <button type="button" className={styles.settings} aria-label="返回账户与电脑" onClick={() => setScreen('home')}>
        <ArrowLeft size={16} /></button><span>{screen === 'accounts' ? '切换账户' : '选择电脑'}</span>
      <small title={computerName}>{computerName}</small>
    </div>}
    {accounts ? props.accounts : screen === 'computers' && computers
      ? <ComputerList navigation={computers} close={close} busy={Boolean(props.busy)} />
      : <section className={`${styles.group} ${styles.menuHome}`} aria-label="账户与电脑">
        <button type="button" className={styles.option} aria-label="切换电脑" onClick={() => {
          setScreen('computers'); computers?.refresh();
        }}><Monitor size={17} /><span>切换电脑<small>{computerName}</small></span><ChevronRight size={15} /></button>
        <button type="button" className={styles.option} aria-label="切换账户" onClick={() => {
          setScreen('accounts'); props.onOpenAccounts?.();
        }}><UserRound size={17} /><span>切换账户<small>{props.name}</small></span><ChevronRight size={15} /></button>
      </section>}
  </div>;
  return <Popover trigger="click" placement="topLeft" open={props.open && props.active} content={panel}
    arrow={false} align={{ offset: [0, -2] }} classNames={{ root: styles.popup }}
    styles={{ root: { width, maxWidth: MAX_ACCOUNT_PICKER_WIDTH } }} onOpenChange={props.onOpenChange}>
    <button ref={props.trigger} type="button" className={styles.trigger} aria-expanded={props.open && props.active}
      aria-label={`切换 GUI 账户：${props.name}`}>
      {props.icon}<span className={styles.triggerBody}>{props.summary}
        {computers && <small className={styles.computerName}><Monitor size={11} />{computerName}</small>}
      </span><ChevronsUpDown size={14} />
    </button>
  </Popover>;
}
