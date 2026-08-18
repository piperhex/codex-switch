import { LayoutGrid, TableProperties } from "lucide-react";
import type { AccountDisplayMode } from "../../hooks/useAccountDisplayMode";
import type { Translate } from "../../i18n";

interface AccountDisplayTabsProps {
  displayMode: AccountDisplayMode;
  onChange: (mode: AccountDisplayMode) => void;
  t: Translate;
}

export function AccountDisplayTabs({ displayMode, onChange, t }: AccountDisplayTabsProps) {
  const options = [
    { icon: TableProperties, label: t("settings.accountDisplay.table"), value: "table" },
    { icon: LayoutGrid, label: t("settings.accountDisplay.cards"), value: "cards" },
  ] as const;

  return (
    <div className="account-display-tabs" role="tablist" aria-label={t("settings.accountDisplay.label")}>
      {options.map((option) => {
        const Icon = option.icon;
        const selected = displayMode === option.value;
        return (
          <button key={option.value} type="button" role="tab" aria-selected={selected}
            aria-label={option.label} title={option.label}
            className={selected ? "selected" : undefined} onClick={() => onChange(option.value)}>
            <Icon size={12} />
          </button>
        );
      })}
    </div>
  );
}
