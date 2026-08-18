import { useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { Button, Checkbox, Dropdown, Popconfirm, Space, Table, Tag, Tooltip } from "antd";
import type { ColumnsType } from "antd/es/table";
import { CircleOff, Columns3, Pencil, RotateCcw, Server, Shuffle, Trash2 } from "lucide-react";
import { ImageModelRouteSelect } from "../../components/ImageModelRouteSelect";
import type { Language, Translate } from "../../i18n";
import type {
  Account, ImageModelTarget, ImageRouteKind, Provider, ProviderTokenUsageTotals,
} from "../../types";
import {
  apiFormatTag,
  ProviderBalanceCell,
  ProviderModelCell,
  ProviderModelControlCell,
  ProviderTokenCell,
} from "./ProviderCells";
import {
  isProviderTableColumnKey,
  loadHiddenColumns,
  persistHiddenColumns,
  type ProviderTableColumnKey,
} from "./providerUtils";
import {
  ProviderBulkGroupActions,
  ProviderGroupCell,
  ProviderGroupToolbar,
} from "./ProviderGroupControls";

interface ProviderViewProps {
  providers: Provider[];
  providerGroups: string[];
  accounts: Account[];
  busyProviderId: string | null;
  proxyRunning: boolean;
  proxyBusy: boolean;
  proxyStartDisabledReason?: string;
  language: Language;
  usageForProvider: (provider: Provider) => ProviderTokenUsageTotals | undefined;
  onSwitch: (id: string) => void;
  onSwitchGroup: (group: string) => void;
  onDeactivate: (id: string) => void;
  onStartProxy: () => void;
  onSwitchModel: (id: string, model: string) => void;
  onModelControlChange: (id: string, controlledByCodex: boolean) => void;
  onGroupChange: (id: string, group: string) => void;
  onGroupChangeMany: (ids: string[], group: string) => Promise<string[]>;
  onAutoSwitchChange: (id: string, enabled: boolean) => void;
  onDelete: (id: string) => void;
  onEdit: (provider: Provider) => void;
  imageInputTarget: ImageModelTarget | null;
  imageOutputTarget: ImageModelTarget | null;
  imageModelBusy: boolean;
  onImageModelChange: (routeKind: ImageRouteKind, target: ImageModelTarget | null) => void;
  privacyMode: boolean;
  t: Translate;
}

function ProviderProxyModeWarning({ options, cardView = false }: {
  options: Pick<ProviderViewProps,
    "onStartProxy" | "proxyBusy" | "proxyRunning" | "proxyStartDisabledReason" | "t">;
  cardView?: boolean;
}) {
  if (options.proxyRunning) return null;
  const button = (
    <Button danger size="small" loading={options.proxyBusy}
      disabled={Boolean(options.proxyStartDisabledReason)}>
      {options.t("providers.proxy.enable")}
    </Button>
  );
  const action = options.proxyStartDisabledReason ? (
    <Tooltip title={options.proxyStartDisabledReason}>
      <span className="provider-proxy-warning-action">{button}</span>
    </Tooltip>
  ) : (
    <Popconfirm title={options.t("providers.proxy.startConfirmTitle")}
      description={<span className="proxy-start-confirm-description">
        {options.t("providers.proxy.description")}
      </span>}
      okText={options.t("providers.proxy.start")} cancelText={options.t("providers.proxy.cancel")}
      disabled={options.proxyBusy} onConfirm={options.onStartProxy}>
      {button}
    </Popconfirm>
  );
  return (
    <div className={`provider-proxy-warning${cardView ? " card-view" : ""}`}>
      <span>{options.t("providers.proxy.requiredForSwitch")}</span>
      {action}
    </div>
  );
}

interface ProviderTableProps extends ProviderViewProps {
  onDeleteMany: (ids: string[]) => Promise<string[]>;
  selectedProviderIds: string[];
  setSelectedProviderIds: Dispatch<SetStateAction<string[]>>;
  bulkDeleteBusy: boolean;
  setBulkDeleteBusy: Dispatch<SetStateAction<boolean>>;
}

function ProviderImageModelControls(options: ProviderViewProps) {
  return <div className="proxy-image-model-fields">
    <ImageModelRouteSelect accounts={options.accounts} providers={options.providers} routeKind="input"
      target={options.imageInputTarget} busy={options.imageModelBusy}
      onChange={options.onImageModelChange} privacyMode={options.privacyMode} t={options.t} />
    <ImageModelRouteSelect accounts={options.accounts} providers={options.providers} routeKind="output"
      target={options.imageOutputTarget} busy={options.imageModelBusy}
      onChange={options.onImageModelChange} privacyMode={options.privacyMode} t={options.t} />
  </div>;
}

function ProviderActions({ provider, options }: {
  provider: Provider;
  options: Pick<ProviderViewProps,
    "busyProviderId" | "proxyRunning" | "onAutoSwitchChange" | "onSwitch" | "onDeactivate"
    | "onEdit" | "onDelete" | "t">;
}) {
  const {
    busyProviderId,
    proxyRunning,
    onAutoSwitchChange,
    onSwitch,
    onDeactivate,
    onEdit,
    onDelete,
    t,
  } = options;
  const waiting = busyProviderId === provider.id;
  return (
    <Space size={4} className="table-actions">
      <Tooltip title={provider.active
        ? t("providers.action.cancelUse")
        : provider.supportsDirectSwitch
          ? t("providers.tooltip.switch")
          : t("providers.tooltip.requiresBridge")}>
        <Button size="small" type={provider.active ? "default" : "primary"}
          disabled={!provider.active && !provider.supportsDirectSwitch}
          loading={waiting} icon={provider.active ? <CircleOff size={14} /> : <RotateCcw size={14} />}
          onClick={() => provider.active ? onDeactivate(provider.id) : onSwitch(provider.id)}>
          {provider.active
            ? t("providers.action.cancelUse")
            : proxyRunning
              ? t("providers.action.hotSwitch")
              : t("providers.action.switch")}
        </Button>
      </Tooltip>
      {proxyRunning && provider.kind === "custom" && (
        <Tooltip title={t(provider.autoSwitchEnabled
          ? "providers.tooltip.autoSwitchEnabled"
          : "providers.tooltip.autoSwitch")}>
          <Button size="small" type={provider.autoSwitchEnabled ? "primary" : "default"}
            loading={waiting} icon={<Shuffle size={14} />}
            onClick={() => onAutoSwitchChange(provider.id, !provider.autoSwitchEnabled)}>
            {t("providers.action.autoSwitch")}
          </Button>
        </Tooltip>
      )}
      <Tooltip title={t("providers.tooltip.edit")}>
        <Button size="small" className="table-icon-button" icon={<Pencil size={14} />}
          onClick={() => onEdit(provider)} />
      </Tooltip>
      <Popconfirm title={t("providers.delete.title")} description={t("providers.delete.description")}
        okText={t("providers.delete.ok")} cancelText={t("providers.delete.cancel")}
        okButtonProps={{ danger: true }} onConfirm={() => onDelete(provider.id)}>
        <Tooltip title={t("providers.tooltip.delete")}>
          <Button danger size="small" className="table-icon-button" loading={waiting}
            icon={<Trash2 size={14} />} />
        </Tooltip>
      </Popconfirm>
    </Space>
  );
}

function buildColumns(options: ProviderViewProps): ColumnsType<Provider> {
  const { busyProviderId, language, usageForProvider, onSwitchModel, onModelControlChange, t } = options;
  return [
    {
      title: t("providers.table.provider"), key: "provider", dataIndex: "name", width: 240,
      render: (_, provider) => <div className="provider-cell">
        <div className="provider-avatar"><Server size={15} /></div>
        <div><strong>{provider.name}</strong><span title={provider.baseUrl}>{provider.baseUrl}</span></div>
      </div>,
    },
    {
      title: t("providers.table.group"), key: "group", dataIndex: "group", width: 150,
      render: (_, provider) => <ProviderGroupCell provider={provider} groups={options.providerGroups}
        busy={busyProviderId === provider.id} onChange={options.onGroupChange} t={t} />,
    },
    {
      title: t("providers.table.model"), key: "model", dataIndex: "model", width: 260,
      render: (_, provider) => <ProviderModelCell provider={provider}
        busy={busyProviderId === provider.id} onSwitchModel={onSwitchModel} t={t} />,
    },
    { title: t("providers.table.api"), key: "api", width: 120, render: (_, provider) => apiFormatTag(provider, t) },
    {
      title: t("providers.table.modelControl"), key: "modelControl", width: 190,
      render: (_, provider) => <ProviderModelControlCell provider={provider}
        busy={busyProviderId === provider.id} onModelControlChange={onModelControlChange} t={t} />,
    },
    {
      title: t("providers.table.balance"), key: "balance", width: 155,
      render: (_, provider) => <ProviderBalanceCell provider={provider} t={t} />,
    },
    {
      title: t("providers.table.todayTokens"), key: "todayTokens", width: 105, align: "center",
      render: (_, provider) => <ProviderTokenCell usage={usageForProvider(provider)}
        period="today" language={language} t={t} />,
    },
    {
      title: t("providers.table.totalTokens"), key: "totalTokens", width: 105, align: "center",
      render: (_, provider) => <ProviderTokenCell usage={usageForProvider(provider)}
        period="total" language={language} t={t} />,
    },
    {
      title: t("providers.table.actions"), key: "actions", width: 285, align: "right", fixed: "right",
      render: (_, provider) => <ProviderActions provider={provider} options={options} />,
    },
  ];
}

export function ProviderTableView(options: ProviderTableProps) {
  const {
    providers,
    onDeleteMany,
    selectedProviderIds,
    setSelectedProviderIds,
    bulkDeleteBusy,
    setBulkDeleteBusy,
    t,
  } = options;
  const [hiddenColumns, setHiddenColumns] = useState<ProviderTableColumnKey[]>(loadHiddenColumns);
  const columns = buildColumns(options);
  const hiddenColumnSet = new Set(hiddenColumns);
  const selectedProviderIdSet = new Set(selectedProviderIds);
  const selectedProviders = providers.filter((provider) => selectedProviderIdSet.has(provider.id));
  const visibleColumns = columns.filter((column) =>
    !isProviderTableColumnKey(column.key) || !hiddenColumnSet.has(column.key));
  const columnSettings: { key: ProviderTableColumnKey; label: string }[] = [
    { key: "provider", label: t("providers.table.provider") },
    { key: "group", label: t("providers.table.group") },
    { key: "model", label: t("providers.table.model") },
    { key: "api", label: t("providers.table.api") },
    { key: "modelControl", label: t("providers.table.modelControl") },
    { key: "balance", label: t("providers.table.balance") },
    { key: "todayTokens", label: t("providers.table.todayTokens") },
    { key: "totalTokens", label: t("providers.table.totalTokens") },
    { key: "actions", label: t("providers.table.actions") },
  ];
  const visibleColumnCount = columnSettings.filter(({ key }) => !hiddenColumnSet.has(key)).length;
  const tableScrollX = 36 + visibleColumns.reduce(
    (total, column) => total + (typeof column.width === "number" ? column.width : 0), 0,
  );
  const setColumnVisible = (key: ProviderTableColumnKey, visible: boolean) => setHiddenColumns((current) => {
    if (!visible && !current.includes(key) && visibleColumnCount <= 1) return current;
    const next = visible ? current.filter((column) => column !== key) : [...new Set([...current, key])];
    persistHiddenColumns(next);
    return next;
  });
  const deleteSelected = async () => {
    const ids = [...selectedProviderIds];
    setBulkDeleteBusy(true);
    try {
      const deletedIdSet = new Set(await onDeleteMany(ids));
      setSelectedProviderIds((current) => current.filter((id) => !deletedIdSet.has(id)));
    } finally {
      setBulkDeleteBusy(false);
    }
  };
  return <div className="provider-table-wrap">
    <div className="provider-table-toolbar">
      <ProviderProxyModeWarning options={options} />
      <ProviderGroupToolbar providers={providers} busyProviderId={options.busyProviderId}
        proxyRunning={options.proxyRunning} onSwitchGroup={options.onSwitchGroup} t={t} />
      {options.proxyRunning && (
        <ProviderImageModelControls {...options} />
      )}
      <ProviderBulkGroupActions groups={options.providerGroups} selectedProviders={selectedProviders}
        busy={Boolean(options.busyProviderId)} onChangeMany={options.onGroupChangeMany} t={t} />
      <Popconfirm title={t("providers.batchDelete.title", { count: selectedProviderIds.length })}
        description={t("providers.batchDelete.description")} okText={t("providers.delete.ok")}
        cancelText={t("providers.delete.cancel")} okButtonProps={{ danger: true }}
        disabled={!selectedProviderIds.length || bulkDeleteBusy} onConfirm={deleteSelected}>
        <Button danger size="small" icon={<Trash2 size={14} />} loading={bulkDeleteBusy}
          disabled={!selectedProviderIds.length}>
          {t("providers.batchDelete.action", { count: selectedProviderIds.length })}
        </Button>
      </Popconfirm>
      <Dropdown trigger={["click"]} placement="bottomRight" dropdownRender={() => (
        <div className="provider-column-settings" onClick={(event) => event.stopPropagation()}>
          <strong>{t("table.columnSettings")}</strong>
          <div className="provider-column-settings-list">{columnSettings.map(({ key, label }) => {
            const checked = !hiddenColumnSet.has(key);
            return <Checkbox key={key} checked={checked} disabled={checked && visibleColumnCount <= 1}
              onChange={(event) => setColumnVisible(key, event.target.checked)}>{label}</Checkbox>;
          })}</div>
        </div>
      )}>
        <Tooltip title={t("table.columnSettings")}><Button size="small" className="table-icon-button"
          aria-label={t("table.columnSettings")} icon={<Columns3 size={15} />} /></Tooltip>
      </Dropdown>
    </div>
    <Table rowKey="id" size="small" columns={visibleColumns} dataSource={providers}
      rowSelection={{ fixed: true, columnWidth: 36, selectedRowKeys: selectedProviderIds,
        onChange: (keys) => setSelectedProviderIds(keys.map(String)) }}
      rowClassName={(provider) => [
        provider.active ? "active-row" : "",
        !options.proxyRunning ? "proxy-required-row" : "",
      ].filter(Boolean).join(" ")}
      pagination={false} scroll={{ x: tableScrollX }} />
  </div>;
}

function ProviderCard({ provider, options }: { provider: Provider; options: ProviderViewProps }) {
  const {
    busyProviderId,
    language,
    usageForProvider,
    onSwitch,
    onDeactivate,
    onSwitchModel,
    onModelControlChange,
    onAutoSwitchChange,
    onDelete,
    onEdit,
    t,
  } = options;
  const waiting = busyProviderId === provider.id;
  const cardClassName = `provider-card${provider.active ? " active" : ""}`
    + `${options.proxyRunning ? "" : " proxy-required-card"}`
    + `${provider.supportsDirectSwitch ? " switchable" : ""}`;
  return <article className={cardClassName} onClick={(event) => {
    if ((event.target as HTMLElement).closest("button, input, select, .ant-select")) return;
    if (!provider.active && provider.supportsDirectSwitch) onSwitch(provider.id);
  }}>
    <div className="card-topline" />
    <header className="provider-card-head">
      <div className="provider-avatar"><Server size={18} /></div>
      <div><strong>{provider.name}</strong><span title={provider.baseUrl}>{provider.baseUrl}</span></div>
      {provider.active
        ? <Tag className="current-tag">{t("providers.status.current")}</Tag>
        : provider.supportsDirectSwitch
          ? <Tag>{t("providers.status.ready")}</Tag>
          : <Tag color="gold">{t("providers.status.bridgeRequired")}</Tag>}
      <div className="provider-card-top-actions">
        {provider.active && (
          <Tooltip title={t("providers.action.cancelUse")}>
            <Button size="small" className="table-icon-button" loading={waiting}
              aria-label={t("providers.action.cancelUse")} icon={<CircleOff size={14} />}
              onClick={() => onDeactivate(provider.id)} />
          </Tooltip>
        )}
        {options.proxyRunning && provider.kind === "custom" && (
          <Tooltip title={t(provider.autoSwitchEnabled
            ? "providers.tooltip.autoSwitchEnabled"
            : "providers.tooltip.autoSwitch")}>
            <Button size="small" type={provider.autoSwitchEnabled ? "primary" : "default"}
              className="table-icon-button" loading={waiting}
              aria-label={t("providers.action.autoSwitch")} icon={<Shuffle size={14} />}
              onClick={() => onAutoSwitchChange(provider.id, !provider.autoSwitchEnabled)} />
          </Tooltip>
        )}
        <Popconfirm title={t("providers.delete.title")} description={t("providers.delete.description")}
          okText={t("providers.delete.ok")} cancelText={t("providers.delete.cancel")}
          okButtonProps={{ danger: true }} onConfirm={() => onDelete(provider.id)}>
          <Tooltip title={t("providers.tooltip.delete")}>
            <Button danger size="small" className="table-icon-button"
              loading={waiting} icon={<Trash2 size={14} />} />
          </Tooltip>
        </Popconfirm>
        <Tooltip title={t("providers.tooltip.edit")}>
          <Button size="small" className="table-icon-button"
            icon={<Pencil size={14} />} onClick={() => onEdit(provider)} />
        </Tooltip>
      </div>
    </header>
    <div className="provider-card-details">
      <div><span>{t("providers.table.model")}</span><ProviderModelCell provider={provider}
        busy={waiting} onSwitchModel={onSwitchModel} t={t} /></div>
      <div><span>{t("providers.table.group")}</span><ProviderGroupCell provider={provider}
        groups={options.providerGroups} busy={waiting} onChange={options.onGroupChange} t={t} /></div>
      <div><span>{t("providers.table.api")}</span>{apiFormatTag(provider, t)}</div>
      <div><span>{t("providers.table.modelControl")}</span><ProviderModelControlCell provider={provider}
        busy={waiting} onModelControlChange={onModelControlChange} t={t} /></div>
      <div><span>{t("providers.table.balance")}</span><ProviderBalanceCell provider={provider} t={t} /></div>
      <div><span>{t("providers.table.todayTokens")}</span><ProviderTokenCell
        usage={usageForProvider(provider)} period="today" language={language} t={t} /></div>
      <div><span>{t("providers.table.totalTokens")}</span><ProviderTokenCell
        usage={usageForProvider(provider)} period="total" language={language} t={t} /></div>
    </div>
  </article>;
}

export function ProviderCardView(options: ProviderViewProps) {
  return <>
    <ProviderProxyModeWarning options={options} cardView />
    <ProviderGroupToolbar providers={options.providers} busyProviderId={options.busyProviderId}
      proxyRunning={options.proxyRunning} onSwitchGroup={options.onSwitchGroup} t={options.t} />
    {options.proxyRunning && (
      <div className="provider-card-image-model-toolbar">
        <ProviderImageModelControls {...options} />
      </div>
    )}
    <div className="provider-card-grid">
      {options.providers.map((provider) => (
        <ProviderCard key={provider.id} provider={provider} options={options} />
      ))}
    </div>
  </>;
}
