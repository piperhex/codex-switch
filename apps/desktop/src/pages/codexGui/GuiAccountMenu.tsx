import { type ReactNode, type RefObject } from 'react';
import { Popover } from 'antd';
import { ChevronsUpDown, Monitor, X } from 'lucide-react';
import type { GuiComputerNavigation } from './remote/types';
import { GuiDevicePicker } from './GuiDevicePicker';
import { MAX_ACCOUNT_PICKER_WIDTH, useAccountPickerWidth } from './useAccountPickerWidth';
import styles from './ProxyAccountPicker.module.less';

interface Props {
  active: boolean; open: boolean; onOpenChange: (open: boolean) => void;
  trigger: RefObject<HTMLButtonElement>; name: string; icon: ReactNode; summary: ReactNode; accounts: ReactNode;
  computers?: GuiComputerNavigation; busy?: boolean;
}

/** Local and remote accounts share one panel with an independent device dropdown. */
export function GuiAccountMenu(props: Props) {
  const width = useAccountPickerWidth(props.active);
  const visible = props.open && props.active;
  const close = () => { props.onOpenChange(false); props.trigger.current?.focus(); };
  const panel = <div className={styles.panel} onKeyDown={(event) => {
    if (event.key === 'Escape') { event.stopPropagation(); close(); }
  }}>
    <header className={styles.header}>
      <h2>切换账户</h2>
      {visible && props.computers && <GuiDevicePicker navigation={props.computers}
        busy={Boolean(props.busy)} onSelect={close} />}
      <button type="button" className={styles.close} aria-label="关闭账户面板" onClick={close}><X size={20} /></button>
    </header>
    {visible && props.accounts}
  </div>;
  return <Popover trigger="click" placement="topLeft" open={visible} content={panel} fresh
    arrow={false} align={{ offset: [0, -2] }} classNames={{ root: styles.popup }}
    styles={{ root: { width, maxWidth: MAX_ACCOUNT_PICKER_WIDTH } }} onOpenChange={props.onOpenChange}>
    <button ref={props.trigger} type="button" className={styles.trigger} aria-expanded={visible}
      aria-label={`切换 GUI 账户：${props.name}`}>
      {props.icon}<span className={styles.triggerBody}>{props.summary}
        {props.computers && <small className={styles.computerName}>
          <Monitor size={11} />{props.computers.current?.name ?? '本机'}
        </small>}
      </span><ChevronsUpDown size={14} />
    </button>
  </Popover>;
}
