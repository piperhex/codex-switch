import { useState } from "react";
import type { Translate } from "../../i18n";
import type { Account } from "../../types";
import { AutoSwitchPriorityInput, AutoSwitchThresholdInput } from "./AccountTableParts";
import styles from "./AccountCardAutoSwitchSettings.module.less";

type SettingProps = {
  account: Account;
  kind: "priority" | "threshold";
  disabled: boolean;
  onSave: (id: string, value: number) => Promise<boolean>;
  t: Translate;
};

function EditableSetting({ account, kind, disabled, onSave, t }: SettingProps) {
  const [editing, setEditing] = useState(false);
  const isPriority = kind === "priority";
  const label = t(isPriority ? "table.autoSwitchPriority" : "table.autoSwitchThreshold");
  const shortLabel = t(isPriority ? "table.cardSwitchPriority" : "table.cardSwitchThreshold");
  const value = isPriority ? account.autoSwitchPriority : `${account.autoSwitchThreshold}%`;
  const Input = isPriority ? AutoSwitchPriorityInput : AutoSwitchThresholdInput;

  return <div className={styles.setting} onKeyDown={(event) => {
    if (event.key === "Escape") {
      event.stopPropagation();
      setEditing(false);
    }
  }}>
    {editing ? <>
      <Input account={account} disabled={disabled} onSave={onSave} t={t}
        autoFocus onFinish={() => setEditing(false)} />
    </> : <button type="button" disabled={disabled} onClick={() => setEditing(true)}
      title={label} aria-label={`${label} ${value}`}>
      <span>{shortLabel}</span>
      <strong>{value}</strong>
    </button>}
  </div>;
}

export function AccountCardAutoSwitchSettings({ account, priorityEnabled, thresholdEnabled,
  priorityBusy, thresholdBusy, onPrioritySave, onThresholdSave, t }: {
  account: Account;
  priorityEnabled: boolean;
  thresholdEnabled: boolean;
  priorityBusy: boolean;
  thresholdBusy: boolean;
  onPrioritySave: SettingProps["onSave"];
  onThresholdSave: SettingProps["onSave"];
  t: Translate;
}) {
  if (!priorityEnabled && !thresholdEnabled) return null;

  return <div className={styles.settings} onClick={(event) => event.stopPropagation()}>
    {priorityEnabled && <EditableSetting account={account} kind="priority" disabled={priorityBusy}
      onSave={onPrioritySave} t={t} />}
    {thresholdEnabled && <EditableSetting account={account} kind="threshold" disabled={thresholdBusy}
      onSave={onThresholdSave} t={t} />}
  </div>;
}
