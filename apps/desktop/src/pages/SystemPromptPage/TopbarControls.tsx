import { Button, Switch } from "antd";
import { Plus } from "lucide-react";
import type { Translate } from "../../i18n";
import styles from "./index.module.less";

interface TopbarControlsProps {
  filterEnabled: boolean;
  injectionEnabled: boolean;
  loading: boolean;
  onAdd: () => void;
  onFilterEnabledChange: (enabled: boolean) => void;
  onInjectionEnabledChange: (enabled: boolean) => void;
  t: Translate;
}

export function TopbarControls(props: TopbarControlsProps) {
  const {
    filterEnabled,
    injectionEnabled,
    loading,
    onAdd,
    onFilterEnabledChange,
    onInjectionEnabledChange,
    t,
  } = props;
  return (
    <div className={styles.topbarControls}>
      <span className={styles.masterSwitchLabel}>{t("systemPrompts.masterSwitch")}</span>
      <label className={styles.enabledControl}>
        <span>{t("systemPrompts.filter")}</span>
        <Switch
          aria-label={t("systemPrompts.toggleFilter")}
          checked={filterEnabled}
          disabled={loading}
          onChange={onFilterEnabledChange}
          size="small"
        />
      </label>
      <label className={styles.enabledControl}>
        <span>{t("systemPrompts.injection")}</span>
        <Switch
          aria-label={t("systemPrompts.toggleInjection")}
          checked={injectionEnabled}
          disabled={loading}
          onChange={onInjectionEnabledChange}
          size="small"
        />
      </label>
      <Button disabled={loading} icon={<Plus size={16} />} onClick={onAdd} type="primary">
        {t("systemPrompts.addRule")}
      </Button>
    </div>
  );
}
