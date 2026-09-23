import { Check, Server } from 'lucide-react';
import type { Account } from '../../types';
import { ProxyAccountDetails } from './ProxyAccountDetails';
import styles from './ProxyAccountPicker.module.less';

export interface GuiAccountChoice {
  id: string; name: string; detail: string; selected: boolean; disabled?: boolean;
  usage?: Account['usage']; searchDetail?: string;
}

export function GuiAccountGroup({ title, choices, onSelect, disabled, kind }: {
  title: string; choices: GuiAccountChoice[]; onSelect: (id: string) => void; disabled: boolean;
  kind: 'account' | 'provider';
}) {
  return <section className={styles.group} aria-label={title}>
    {choices.length ? choices.map((choice) => <button key={choice.id} type="button"
      className={`${styles.option} ${choice.selected ? styles.selected : ''}`}
      aria-pressed={choice.selected} disabled={disabled || choice.disabled}
      onClick={() => { if (!choice.selected) onSelect(choice.id); }}>
      <span className={styles.avatar} aria-hidden="true">{kind === 'provider' ? <Server size={21} />
        : Array.from(choice.name.trim())[0]?.toUpperCase() || '?'}</span>
      <span className={styles.accountBody}>
        <span className={styles.optionName} title={choice.name}>{choice.name}</span>
        {kind === 'account' ? <ProxyAccountDetails plan={choice.detail} usage={choice.usage ?? {}} />
          : choice.detail && <small>{choice.detail}</small>}
        {choice.disabled && <small>此账户暂不可用</small>}
      </span>
      <span className={styles.selectionMark} aria-hidden={!choice.selected}>
        {choice.selected && <Check size={14} aria-label="当前使用" />}
      </span>
    </button>) : <p className={styles.hint}>暂无匹配项</p>}
  </section>;
}
