import { useEffect, useMemo, useState } from "react";
import { Button, Input, Popconfirm, Popover, Space, Tag, Tooltip } from "antd";
import { FolderKanban, FolderMinus, FolderPlus, Play } from "lucide-react";
import type { Translate } from "../../i18n";
import type { Provider } from "../../types";

interface ProviderGroupEditorProps {
  group: string;
  groups: string[];
  optionsId: string;
  disabled: boolean;
  loading?: boolean;
  onChange: (group: string) => void;
  onSave: () => void;
  onCancel: () => void;
  t: Translate;
}

function ProviderGroupEditor(options: ProviderGroupEditorProps) {
  const save = () => {
    if (!options.disabled) options.onSave();
  };
  return <div className="provider-group-editor">
    <Input value={options.group} maxLength={80} placeholder={options.t("providers.group.placeholder")}
      list={options.optionsId} onChange={(event) => options.onChange(event.target.value)}
      onPressEnter={save} />
    <datalist id={options.optionsId}>
      {options.groups.map((value) => <option key={value} value={value} />)}
    </datalist>
    <Space size={6}>
      <Button size="small" onClick={options.onCancel}>{options.t("providers.form.cancel")}</Button>
      <Button size="small" type="primary" loading={options.loading} disabled={options.disabled}
        onClick={save}>{options.t("providers.group.save")}</Button>
    </Space>
  </div>;
}

interface ProviderGroupCellProps {
  provider: Provider;
  providers: Provider[];
  busy: boolean;
  onChange: (id: string, group: string) => void;
  t: Translate;
}

export function ProviderGroupCell({ provider, providers, busy, onChange, t }: ProviderGroupCellProps) {
  const [open, setOpen] = useState(false);
  const [group, setGroup] = useState(provider.group);
  const groups = useMemo(() => [...new Set(providers.map((item) => item.group).filter(Boolean))], [providers]);
  const optionsId = `provider-group-options-${provider.id}`;
  useEffect(() => setGroup(provider.group), [provider.group]);
  if (provider.kind !== "custom") return <span className="provider-group-empty">—</span>;
  const save = () => {
    onChange(provider.id, group);
    setOpen(false);
  };
  const content = <ProviderGroupEditor group={group} groups={groups} optionsId={optionsId}
    disabled={busy || group.trim() === provider.group} onChange={setGroup} onSave={save}
    onCancel={() => setOpen(false)} t={t} />;
  return <Popover open={open} trigger="click" placement="bottomLeft" content={content}
    onOpenChange={setOpen}>
    <Button size="small" type="text" className="provider-group-button" icon={<FolderKanban size={14} />}>
      {provider.group || t("providers.group.ungrouped")}
    </Button>
  </Popover>;
}

interface ProviderGroupToolbarProps {
  providers: Provider[];
  busyProviderId: string | null;
  proxyRunning: boolean;
  onSwitchGroup: (group: string) => void;
  t: Translate;
}

export function ProviderGroupToolbar({
  providers,
  busyProviderId,
  proxyRunning,
  onSwitchGroup,
  t,
}: ProviderGroupToolbarProps) {
  const groups = [...new Set(providers
    .filter((provider) => provider.kind === "custom")
    .map((provider) => provider.group)
    .filter(Boolean))];
  if (!groups.length) return null;
  return <div className="provider-group-toolbar">
    <span>{t("providers.group.startLabel")}</span>
    <Space size={[6, 6]} wrap>{groups.map((group) => {
      const members = providers.filter((provider) => provider.kind === "custom" && provider.group === group);
      const active = members.length > 0 && members.every((provider) => provider.active);
      return <Tooltip key={group} title={t("providers.group.startHint", { count: members.length })}
        styles={{ root: { maxWidth: 400 } }}>
        <Button size="small" type="primary" className="provider-group-start-button" icon={<Play size={13} />}
          loading={busyProviderId === `group:${group}`} disabled={!proxyRunning || active}
          onClick={() => onSwitchGroup(group)}>
          {group}<Tag bordered={false}>{members.length}</Tag>
        </Button>
      </Tooltip>;
    })}</Space>
  </div>;
}

interface ProviderBulkGroupActionsProps {
  providers: Provider[];
  selectedProviders: Provider[];
  busy: boolean;
  onChangeMany: (ids: string[], group: string) => Promise<string[]>;
  t: Translate;
}

export function ProviderBulkGroupActions({
  providers,
  selectedProviders,
  busy,
  onChangeMany,
  t,
}: ProviderBulkGroupActionsProps) {
  const [open, setOpen] = useState(false);
  const [group, setGroup] = useState("");
  const [saving, setSaving] = useState(false);
  const groups = useMemo(() => [...new Set(providers.map((item) => item.group).filter(Boolean))], [providers]);
  const selectedCustomProviders = selectedProviders.filter((provider) => provider.kind === "custom");
  const groupedProviders = selectedCustomProviders.filter((provider) => provider.group);
  const changing = busy || saving;
  const changeMany = async (ids: string[], nextGroup: string) => {
    setSaving(true);
    try {
      await onChangeMany(ids, nextGroup);
      setOpen(false);
    } finally {
      setSaving(false);
    }
  };
  const selectedIds = selectedCustomProviders.map(({ id }) => id);
  const content = <ProviderGroupEditor group={group} groups={groups} optionsId="provider-bulk-group-options"
    disabled={changing || !group.trim()} loading={saving} onChange={setGroup}
    onSave={() => void changeMany(selectedIds, group)} onCancel={() => setOpen(false)} t={t} />;
  return <Space size={6}>
    <Popover open={open} trigger="click" placement="bottomLeft" content={content}
      onOpenChange={(nextOpen) => !changing && setOpen(nextOpen)}>
      <Button size="small" icon={<FolderPlus size={14} />} disabled={!selectedCustomProviders.length || changing}>
        {t("providers.batchGroup.add", { count: selectedCustomProviders.length })}
      </Button>
    </Popover>
    <Popconfirm title={t("providers.batchGroup.removeTitle", { count: groupedProviders.length })}
      description={<span className="provider-batch-group-confirm">
        {t("providers.batchGroup.removeDescription")}
      </span>}
      okText={t("providers.batchGroup.removeOk")} cancelText={t("providers.form.cancel")}
      disabled={!groupedProviders.length || changing}
      onConfirm={() => changeMany(groupedProviders.map(({ id }) => id), "")}>
      <Button size="small" icon={<FolderMinus size={14} />} disabled={!groupedProviders.length || changing}>
        {t("providers.batchGroup.remove", { count: groupedProviders.length })}
      </Button>
    </Popconfirm>
  </Space>;
}
