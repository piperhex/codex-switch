import { useState, type ReactNode } from 'react';
import { Input, Spin } from 'antd';
import { Search } from 'lucide-react';
import { GuiAccountGroup, type GuiAccountChoice } from './GuiAccountGroup';
import styles from './ProxyAccountPicker.module.less';

interface Props {
  choices: GuiAccountChoice[];
  disabled: boolean; loading: boolean; footer: ReactNode;
  devicePicker: ReactNode;
  onSelectAccount: (id: string) => void; onSelectProvider: (id: string) => void;
}

export function GuiAccountList(props: Props) {
  const [query, setQuery] = useState('');
  const choices = props.choices.filter((choice) => `${choice.name} ${choice.detail} ${choice.searchDetail ?? ''}`
    .toLowerCase().includes(query.trim().toLowerCase()));
  return <>
    <div className={styles.list} aria-busy={props.loading}>
      <GuiAccountGroup choices={choices} disabled={props.disabled} onSelect={(choice) => {
        if (choice.kind === 'account') props.onSelectAccount(choice.id);
        else props.onSelectProvider(choice.id);
      }} />
    </div>
    <div className={styles.footer}>
      <div className={styles.searchRow}>
        <Input className={styles.search} prefix={<Search size={14} />}
          placeholder="搜索账户" aria-label="搜索账号或 Provider"
          value={query} allowClear onChange={(event) => setQuery(event.target.value)} />
        {props.loading && <Spin size="small" />}
        {props.devicePicker}
      </div>
      {props.footer}
    </div>
  </>;
}
