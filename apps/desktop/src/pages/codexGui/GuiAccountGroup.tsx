import { Check, Server } from 'lucide-react';
import { ProxyAccountDetails, type ProxyAccountDetailsProps } from './ProxyAccountDetails';
import styles from './ProxyAccountPicker.module.less';

export interface GuiAccountChoice {
  kind: 'account' | 'provider';
  id: string; name: string; detail: string; selected: boolean; disabled?: boolean;
  accountDetails?: ProxyAccountDetailsProps; searchDetail?: string;
}

export function GuiAccountGroup({ choices, onSelect, disabled }: {
  choices: GuiAccountChoice[]; onSelect: (choice: GuiAccountChoice) => void; disabled: boolean;
}) {
  return <section className={styles.group} aria-label="账户列表">
    {choices.length ? choices.map((choice) => <button key={`${choice.kind}:${choice.id}`} type="button"
      className={`${styles.option} ${choice.selected ? styles.selected : ''}`}
      aria-pressed={choice.selected} disabled={disabled || choice.disabled}
      onClick={() => { if (!choice.selected) onSelect(choice); }}>
      <span className={`${styles.avatar} ${choice.kind === 'provider' ? styles.providerAvatar : ''}`}
        role="img" aria-label={choice.kind === 'provider' ? '第三方 Provider' : '官方账号'}>
        {choice.kind === 'provider' ? <Server size={16} aria-hidden="true" />
        : Array.from(choice.name.trim())[0]?.toUpperCase() || '?'}</span>
      <span className={styles.accountBody}>
        <span className={styles.optionName} title={choice.name}>{choice.name}</span>
        {choice.kind === 'account' && choice.accountDetails ? <ProxyAccountDetails {...choice.accountDetails} />
          : choice.detail && <small>{choice.detail}</small>}
        {choice.disabled && <small>此账户暂不可用</small>}
      </span>
      <span className={styles.selectionMark} aria-hidden={!choice.selected}>
        {choice.selected && <Check size={14} aria-label="当前使用" />}
      </span>
    </button>) : <p className={styles.hint}>暂无匹配项</p>}
  </section>;
}
