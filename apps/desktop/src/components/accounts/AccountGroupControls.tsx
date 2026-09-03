import { useEffect, useState } from "react";
import { Button, Input, Popover, Select, Switch, Tooltip } from "antd";
import { FolderKanban } from "lucide-react";
import type { Translate } from "../../i18n";
import type { Account } from "../../types";

interface AccountGroupCellProps {
  account: Account;
  groups: string[];
  onChange: (id: string, group: string) => Promise<boolean>;
  t: Translate;
}

export function AccountGroupCell({ account, groups, onChange, t }: AccountGroupCellProps) {
  const [open, setOpen] = useState(false);
  const [group, setGroup] = useState(account.group);
  const [saving, setSaving] = useState(false);
  const optionsId = `account-group-options-${account.id}`;
  useEffect(() => setGroup(account.group), [account.group]);

  const save = async () => {
    if (saving || group.trim() === account.group) return;
    setSaving(true);
    try {
      if (await onChange(account.id, group)) setOpen(false);
    } finally {
      setSaving(false);
    }
  };
  const content = <div className="account-group-editor">
    <Input value={group} maxLength={80} placeholder={t("accounts.group.placeholder")}
      list={optionsId} onChange={(event) => setGroup(event.target.value)}
      onPressEnter={() => void save()} />
    <datalist id={optionsId}>{groups.map((value) => <option key={value} value={value} />)}</datalist>
    <div className="account-group-editor-actions">
      <Button size="small" onClick={() => setOpen(false)}>{t("table.cancel")}</Button>
      <Button size="small" type="primary" loading={saving} disabled={group.trim() === account.group}
        onClick={() => void save()}>{t("accounts.group.save")}</Button>
    </div>
  </div>;

  return <Popover open={open} trigger="click" placement="bottomLeft" content={content}
    onOpenChange={(nextOpen) => !saving && setOpen(nextOpen)}>
    <Button size="small" type="text" className="account-group-button" icon={<FolderKanban size={14} />}>
      {account.group || t("accounts.group.ungrouped")}
    </Button>
  </Popover>;
}

interface ConcurrentRoutingControlProps {
  busy: boolean;
  enabled: boolean;
  groups: string[];
  hotSwitchEnabled: boolean;
  selectedGroup: string | null;
  onChange: (enabled: boolean, group: string | null) => void;
  t: Translate;
}

export function ConcurrentRoutingControl(options: ConcurrentRoutingControlProps) {
  const [pendingGroup, setPendingGroup] = useState(options.selectedGroup ?? "");
  useEffect(() => setPendingGroup(options.selectedGroup ?? ""), [options.selectedGroup]);
  const selectedGroup = options.groups.includes(pendingGroup) ? pendingGroup : "";
  const updateGroup = (group: string) => {
    setPendingGroup(group);
    if (options.enabled) options.onChange(true, group || null);
  };

  return <Tooltip title={options.t("table.concurrentRoutingTooltip")} styles={{ root: { maxWidth: 400 } }}>
    <span className={`account-concurrent-routing-control${options.enabled ? " is-enabled" : ""}`}>
      <span>{options.t("table.concurrentRouting")}</span>
      {options.groups.length > 0 && <Select size="small" value={selectedGroup}
        popupMatchSelectWidth={false} aria-label={options.t("accounts.group.concurrentScope")}
        disabled={!options.hotSwitchEnabled || options.busy}
        options={[
          { label: options.t("accounts.group.allAccounts"), value: "" },
          ...options.groups.map((group) => ({ label: group, value: group })),
        ]}
        onChange={updateGroup} />}
      <Switch size="small" checked={options.enabled} loading={options.busy}
        disabled={!options.hotSwitchEnabled || options.busy}
        aria-label={options.t("table.concurrentRouting")}
        onChange={(enabled) => options.onChange(enabled, selectedGroup || null)} />
    </span>
  </Tooltip>;
}
