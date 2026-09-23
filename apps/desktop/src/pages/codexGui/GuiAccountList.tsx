import { useId, useRef, useState, type ReactNode } from 'react';
import { Input, Spin } from 'antd';
import { Search } from 'lucide-react';
import { GuiAccountGroup, type GuiAccountChoice } from './GuiAccountGroup';
import styles from './ProxyAccountPicker.module.less';

type AccountTab = 'account' | 'provider';
interface Props {
  accounts: GuiAccountChoice[]; providers: GuiAccountChoice[]; initialTab: AccountTab;
  disabled: boolean; loading: boolean; footer: ReactNode;
  onSelectAccount: (id: string) => void; onSelectProvider: (id: string) => void;
}

const TABS = [{ key: 'account', title: '官方账号' }, { key: 'provider', title: '第三方 Provider' }] as const;

function nextTab(key: string, current: AccountTab): AccountTab {
  if (key === 'Home') return 'account';
  if (key === 'End') return 'provider';
  return current === 'account' ? 'provider' : 'account';
}

export function GuiAccountList(props: Props) {
  const [tab, setTab] = useState(props.initialTab);
  const [query, setQuery] = useState('');
  const id = useId();
  const tabList = useRef<HTMLDivElement>(null);
  const allChoices = tab === 'account' ? props.accounts : props.providers;
  const choices = allChoices.filter((choice) => `${choice.name} ${choice.detail} ${choice.searchDetail ?? ''}`
    .toLowerCase().includes(query.trim().toLowerCase()));
  const title = tab === 'account' ? '官方账号' : '第三方 Provider';
  const searchLabel = tab === 'account' ? '搜索账号或邮箱' : '搜索 Provider';
  return <>
    <div ref={tabList} role="tablist" aria-label="账户类型" className={styles.tabs} onKeyDown={(event) => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const next = nextTab(event.key, tab);
      setTab(next);
      tabList.current?.querySelector<HTMLButtonElement>(`[data-tab="${next}"]`)?.focus();
    }}>
      {TABS.map((entry) => <button type="button" role="tab" key={entry.key} data-tab={entry.key}
        id={`${id}-${entry.key}`} aria-controls={`${id}-list`} aria-selected={tab === entry.key}
        tabIndex={tab === entry.key ? 0 : -1} onClick={() => setTab(entry.key)}>
        {entry.title} <span>({entry.key === 'account' ? props.accounts.length : props.providers.length})</span>
      </button>)}
    </div>
    <div className={styles.searchRow}>
      <Input className={styles.search} prefix={<Search size={17} />} placeholder={searchLabel} aria-label={searchLabel}
        value={query} allowClear onChange={(event) => setQuery(event.target.value)} />
      {props.loading && <Spin size="small" />}
    </div>
    <div id={`${id}-list`} role="tabpanel" aria-labelledby={`${id}-${tab}`}
      className={styles.list} aria-busy={props.loading}>
      <GuiAccountGroup title={title} choices={choices} disabled={props.disabled} kind={tab}
        onSelect={tab === 'account' ? props.onSelectAccount : props.onSelectProvider} />
    </div>
    <div className={styles.footer}>{props.footer}</div>
  </>;
}
