import { useEffect, useMemo, useState } from "react";
import { Button, Input, Popover, Space, Tag, Tooltip } from "antd";
import { FolderKanban, Play } from "lucide-react";
import type { Translate } from "../../i18n";
import type { Provider } from "../../types";

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
  const content = <div className="provider-group-editor">
    <Input value={group} maxLength={80} placeholder={t("providers.group.placeholder")}
      list={optionsId} onChange={(event) => setGroup(event.target.value)}
      onPressEnter={save} />
    <datalist id={optionsId}>{groups.map((value) => <option key={value} value={value} />)}</datalist>
    <Space size={6}>
      <Button size="small" onClick={() => setOpen(false)}>{t("providers.form.cancel")}</Button>
      <Button size="small" type="primary" disabled={busy || group.trim() === provider.group}
        onClick={save}>{t("providers.group.save")}</Button>
    </Space>
  </div>;
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
        <Button size="small" type={active ? "primary" : "default"} icon={<Play size={13} />}
          loading={busyProviderId === `group:${group}`} disabled={!proxyRunning || active}
          onClick={() => onSwitchGroup(group)}>
          {group}<Tag bordered={false}>{members.length}</Tag>
        </Button>
      </Tooltip>;
    })}</Space>
  </div>;
}
