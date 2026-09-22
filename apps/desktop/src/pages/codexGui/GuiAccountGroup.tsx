import { Check } from 'lucide-react';
import type { Account } from '../../types';
import { ProxyAccountDetails } from './ProxyAccountDetails';
import styles from './ProxyAccountPicker.module.less';

export interface GuiAccountChoice {
  id: string; name: string; detail: string; selected: boolean; disabled?: boolean; usage?: Account['usage'];
}

export function GuiAccountGroup({ title, choices, onSelect, disabled }: {
  title: string; choices: GuiAccountChoice[]; onSelect: (id: string) => void; disabled: boolean;
}) {
  return <section className={styles.group} aria-label={title}>
    <h3>{title}</h3>
    {choices.length ? choices.map((choice) => <button key={choice.id} type="button"
      className={`${styles.option} ${choice.selected ? styles.selected : ''}`}
      aria-pressed={choice.selected} disabled={disabled || choice.disabled}
      onClick={() => { if (!choice.selected) onSelect(choice.id); }}>
      <span>
        <span className={styles.optionName} title={choice.name}>{choice.name}</span>
        {choice.usage ? <ProxyAccountDetails plan={choice.detail} usage={choice.usage} />
          : choice.detail && <small>{choice.detail}</small>}
        {choice.disabled && <small>此账户暂不可用</small>}
      </span>
      {choice.selected && <Check size={15} aria-label="当前使用" />}
    </button>) : <p className={styles.hint}>暂无匹配项</p>}
  </section>;
}
