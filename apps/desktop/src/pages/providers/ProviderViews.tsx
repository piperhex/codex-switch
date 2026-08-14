import { useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { Button, Checkbox, Dropdown, Popconfirm, Space, Table, Tag, Tooltip } from "antd";
import type { ColumnsType } from "antd/es/table";
import { Check, Columns3, Pencil, RotateCcw, Server, Shuffle, Trash2 } from "lucide-react";
import { ImageAccountSelect } from "../../components/ImageAccountSelect";
import type { Language, Translate } from "../../i18n";
import type { Account, Provider, ProviderTokenUsageTotals } from "../../types";
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

interface ProviderViewProps {
  providers: Provider[];
  busyProviderId: string | null;
  proxyRunning: boolean;
  language: Language;
  usageForProvider: (provider: Provider) => ProviderTokenUsageTotals | undefined;
  onSwitch: (id: string) => void;
  onSwitchModel: (id: string, model: string) => void;
  onModelControlChange: (id: string, controlledByCodex: boolean) => void;
  onAutoSwitchChange: (id: string, enabled: boolean) => void;
  onDelete: (id: string) => void;
  onEdit: (provider: Provider) => void;
  t: Translate;
}

interface ProviderTableProps extends ProviderViewProps {
  accounts: Account[];
  imageGenerationAccountId: string | null;
  imageAccountBusy: boolean;
  onImageAccountChange: (accountId: string | null) => void;
  privacyMode: boolean;
  onDeleteMany: (ids: string[]) => Promise<string[]>;
  selectedProviderIds: string[];
  setSelectedProviderIds: Dispatch<SetStateAction<string[]>>;
  bulkDeleteBusy: boolean;
  setBulkDeleteBusy: Dispatch<SetStateAction<boolean>>;
}

function ProviderActions({ provider, options }: {
  provider: Provider;
  options: Pick<ProviderViewProps,
    "busyProviderId" | "proxyRunning" | "onAutoSwitchChange" | "onSwitch" | "onEdit" | "onDelete" | "t">;
}) {
  const { busyProviderId, proxyRunning, onAutoSwitchChange, onSwitch, onEdit, onDelete, t } = options;
  const waiting = busyProviderId === provider.id;
  return (
    <Space size={4} className="table-actions">
      <Tooltip title={provider.supportsDirectSwitch
        ? t("providers.tooltip.switch")
        : t("providers.tooltip.requiresBridge")}>
        <Button size="small" type={provider.active ? "default" : "primary"}
          disabled={provider.active || !provider.supportsDirectSwitch}
          loading={waiting} icon={provider.active ? <Check size={14} /> : <RotateCcw size={14} />}
          onClick={() => onSwitch(provider.id)}>
          {provider.active
            ? t("providers.action.inUse")
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
    accounts,
    imageGenerationAccountId,
    imageAccountBusy,
    onImageAccountChange,
    privacyMode,
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
  const visibleColumns = columns.filter((column) =>
    !isProviderTableColumnKey(column.key) || !hiddenColumnSet.has(column.key));
  const columnSettings: { key: ProviderTableColumnKey; label: string }[] = [
    { key: "provider", label: t("providers.table.provider") },
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
      {options.proxyRunning && (
        <ImageAccountSelect accounts={accounts} accountId={imageGenerationAccountId}
          busy={imageAccountBusy} onChange={onImageAccountChange}
          privacyMode={privacyMode} t={t} />
      )}
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
      rowClassName={(provider) => (provider.active ? "active-row" : "")}
      pagination={false} scroll={{ x: tableScrollX }} />
  </div>;
}

function ProviderCard({ provider, options }: { provider: Provider; options: ProviderViewProps }) {
  const {
    busyProviderId,
    language,
    usageForProvider,
    onSwitch,
    onSwitchModel,
    onModelControlChange,
    onAutoSwitchChange,
    onDelete,
    onEdit,
    t,
  } = options;
  const waiting = busyProviderId === provider.id;
  const cardClassName = `provider-card${provider.active ? " active" : ""}`
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
  return <div className="provider-card-grid">
    {options.providers.map((provider) => <ProviderCard key={provider.id} provider={provider} options={options} />)}
  </div>;
}
