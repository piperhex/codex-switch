import { useCallback, useMemo, useState } from "react";
import { Alert, Button, Input, Modal, Select, Table, Tag, type TableColumnsType } from "antd";
import { RefreshCw, RotateCcw, Search, Trash2 } from "lucide-react";
import {
  loadDeletedCloudAccounts,
  loadDeletedCloudProviders,
  restoreDeletedCloudAccount,
  restoreDeletedCloudProvider,
} from "../api/backend";
import type { Translate } from "../i18n";
import type { DeletedCloudAccount, DeletedCloudProvider } from "../types";

interface CloudRecycleBinProps {
  t: Translate;
  disabled?: boolean;
  triggerClassName?: string;
}

type RecycleBinItem =
  | { type: "account"; value: DeletedCloudAccount }
  | { type: "provider"; value: DeletedCloudProvider };

type RecycleBinTypeFilter = "all" | RecycleBinItem["type"];

function recycleBinItemKey(item: RecycleBinItem) {
  return `${item.type}:${item.value.id}`;
}

function matchesRecycleBinQuery(item: RecycleBinItem, query: string) {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (!normalizedQuery) return true;

  const searchableValues = item.type === "account"
    ? [item.value.email, item.value.note, item.value.plan]
    : [item.value.name, item.value.model];
  return searchableValues.some((value) => value.toLocaleLowerCase().includes(normalizedQuery));
}

export function CloudRecycleBin({ t, disabled, triggerClassName }: CloudRecycleBinProps) {
  const [open, setOpen] = useState(false);
  const [accounts, setAccounts] = useState<DeletedCloudAccount[]>([]);
  const [providers, setProviders] = useState<DeletedCloudProvider[]>([]);
  const [loading, setLoading] = useState(false);
  const [restoringKey, setRestoringKey] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [typeFilter, setTypeFilter] = useState<RecycleBinTypeFilter>("all");
  const [query, setQuery] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [nextAccounts, nextProviders] = await Promise.all([
        loadDeletedCloudAccounts(),
        loadDeletedCloudProviders(),
      ]);
      setAccounts(nextAccounts);
      setProviders(nextProviders);
      setError("");
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message : String(cause);
      setError(`${t("providers.proxy.recycleBinLoadError")}: ${detail}`);
    } finally {
      setLoading(false);
    }
  }, [t]);

  const restore = useCallback(async (item: RecycleBinItem) => {
    const key = recycleBinItemKey(item);
    setRestoringKey(key);
    try {
      if (item.type === "account") {
        await restoreDeletedCloudAccount(item.value.id);
        setAccounts((current) => current.filter((account) => account.id !== item.value.id));
      } else {
        await restoreDeletedCloudProvider(item.value.id);
        setProviders((current) => current.filter((provider) => provider.id !== item.value.id));
      }
      setError("");
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message : String(cause);
      setError(`${t("providers.proxy.recycleBinRestoreError")}: ${detail}`);
    } finally {
      setRestoringKey(null);
    }
  }, [t]);

  const items = useMemo<RecycleBinItem[]>(() => [
    ...accounts.map((value) => ({ type: "account" as const, value })),
    ...providers.map((value) => ({ type: "provider" as const, value })),
  ].sort((left, right) => Date.parse(right.value.deletedAt) - Date.parse(left.value.deletedAt)), [
    accounts,
    providers,
  ]);

  const filteredItems = useMemo(() => items.filter((item) => (
    (typeFilter === "all" || item.type === typeFilter) && matchesRecycleBinQuery(item, query)
  )), [items, query, typeFilter]);

  const columns = useMemo<TableColumnsType<RecycleBinItem>>(() => [
    {
      title: t("providers.proxy.recycleBinType"),
      key: "type",
      width: 90,
      render: (_, item) => (
        <Tag>{t(`providers.proxy.recycleBin${item.type === "account" ? "Account" : "Provider"}`)}</Tag>
      ),
    },
    {
      title: t("providers.proxy.recycleBinItem"),
      key: "item",
      render: (_, item) => (
        <div className="proxy-session-cell">
          <strong>{item.type === "account" ? item.value.email : item.value.name}</strong>
          <span>{item.value.id}</span>
        </div>
      ),
    },
    {
      title: t("providers.proxy.recycleBinDetails"),
      key: "details",
      width: 190,
      render: (_, item) => item.type === "account"
        ? <Tag>{item.value.plan || "—"}</Tag>
        : (
          <div className="proxy-session-cell">
            <strong>{item.value.model}</strong>
            <span>{item.value.baseUrl}</span>
          </div>
        ),
    },
    {
      title: t("providers.proxy.recycleBinDeletedAt"),
      key: "deletedAt",
      width: 190,
      render: (_, item) => new Date(item.value.deletedAt).toLocaleString(),
    },
    {
      title: t("providers.proxy.recycleBinAction"),
      key: "action",
      width: 110,
      align: "right",
      render: (_, item) => {
        const key = recycleBinItemKey(item);
        return (
          <Button type="primary" size="small" icon={<RotateCcw size={13} />}
            loading={restoringKey === key} disabled={restoringKey != null && restoringKey !== key}
            onClick={() => void restore(item)}>
            {t("providers.proxy.recycleBinRestore")}
          </Button>
        );
      },
    },
  ], [restore, restoringKey, t]);

  return (
    <>
      <Button className={triggerClassName} size="small" icon={<Trash2 size={14} />}
        disabled={disabled} title={disabled ? t("providers.proxy.recycleBinLoginRequired") : undefined}
        onClick={() => {
          setTypeFilter("all");
          setQuery("");
          setOpen(true);
          void refresh();
        }}>
        {t("providers.proxy.recycleBin")}
      </Button>
      <Modal className="cloud-recycle-bin-modal" open={open} centered width={900}
        title={t("providers.proxy.recycleBinTitle")} onCancel={() => setOpen(false)}
        footer={<><Button icon={<RefreshCw size={14} />} loading={loading} onClick={() => void refresh()}>
          {t("providers.proxy.sessionsRefresh")}
        </Button><Button type="primary" onClick={() => setOpen(false)}>
          {t("providers.proxy.sessionsClose")}
        </Button></>}>
        <p className="proxy-session-description">{t("providers.proxy.recycleBinDescription")}</p>
        {error ? <Alert type="error" showIcon message={error} /> : null}
        <div className="cloud-recycle-bin-filters">
          <Select value={typeFilter} aria-label={t("providers.proxy.recycleBinType")}
            onChange={setTypeFilter} options={[
              { value: "all", label: t("providers.proxy.recycleBinAllTypes") },
              { value: "account", label: t("providers.proxy.recycleBinAccount") },
              { value: "provider", label: t("providers.proxy.recycleBinProvider") },
            ]} />
          <Input allowClear value={query} prefix={<Search size={14} />}
            placeholder={t("providers.proxy.recycleBinSearchPlaceholder")}
            onChange={(event) => setQuery(event.target.value)} />
        </div>
        <Table rowKey={recycleBinItemKey} size="small" loading={loading} columns={columns}
          dataSource={filteredItems} pagination={false} locale={{
            emptyText: t(items.length === 0
              ? "providers.proxy.recycleBinEmpty"
              : "providers.proxy.recycleBinNoResults"),
          }}
          scroll={{ x: 820, y: "50vh" }} />
      </Modal>
    </>
  );
}
