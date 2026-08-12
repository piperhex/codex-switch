import { useCallback, useMemo, useState } from "react";
import { Alert, Button, Modal, Table, Tag, type TableColumnsType } from "antd";
import { RefreshCw, RotateCcw, Trash2 } from "lucide-react";
import { loadDeletedCloudAccounts, restoreDeletedCloudAccount } from "../api/backend";
import type { Translate } from "../i18n";
import type { DeletedCloudAccount } from "../types";

interface AccountRecycleBinProps {
  t: Translate;
  disabled?: boolean;
  triggerClassName?: string;
}

export function AccountRecycleBin({ t, disabled, triggerClassName }: AccountRecycleBinProps) {
  const [open, setOpen] = useState(false);
  const [accounts, setAccounts] = useState<DeletedCloudAccount[]>([]);
  const [loading, setLoading] = useState(false);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setAccounts(await loadDeletedCloudAccounts());
      setError("");
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message : String(cause);
      setError(`${t("providers.proxy.recycleBinLoadError")}: ${detail}`);
    } finally {
      setLoading(false);
    }
  }, [t]);

  const restore = useCallback(async (account: DeletedCloudAccount) => {
    setRestoringId(account.id);
    try {
      await restoreDeletedCloudAccount(account.id);
      setAccounts((current) => current.filter((item) => item.id !== account.id));
      setError("");
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message : String(cause);
      setError(`${t("providers.proxy.recycleBinRestoreError")}: ${detail}`);
    } finally {
      setRestoringId(null);
    }
  }, [t]);

  const columns = useMemo<TableColumnsType<DeletedCloudAccount>>(() => [
    {
      title: t("providers.proxy.recycleBinAccount"),
      key: "account",
      render: (_, account) => (
        <div className="proxy-session-cell">
          <strong>{account.email}</strong>
          <span>{account.id}</span>
        </div>
      ),
    },
    {
      title: t("providers.proxy.recycleBinPlan"),
      dataIndex: "plan",
      key: "plan",
      width: 130,
      render: (plan: string) => <Tag>{plan || "—"}</Tag>,
    },
    {
      title: t("providers.proxy.recycleBinDeletedAt"),
      dataIndex: "deletedAt",
      key: "deletedAt",
      width: 190,
      render: (deletedAt: string) => new Date(deletedAt).toLocaleString(),
    },
    {
      title: t("providers.proxy.recycleBinAction"),
      key: "action",
      width: 110,
      align: "right",
      render: (_, account) => (
        <Button
          type="primary"
          size="small"
          icon={<RotateCcw size={13} />}
          loading={restoringId === account.id}
          disabled={restoringId != null && restoringId !== account.id}
          onClick={() => void restore(account)}
        >
          {t("providers.proxy.recycleBinRestore")}
        </Button>
      ),
    },
  ], [restore, restoringId, t]);

  return (
    <>
      <Button
        className={triggerClassName}
        size="small"
        icon={<Trash2 size={14} />}
        disabled={disabled}
        title={disabled ? t("providers.proxy.recycleBinLoginRequired") : undefined}
        onClick={() => {
          setOpen(true);
          void refresh();
        }}
      >
        {t("providers.proxy.recycleBin")}
      </Button>
      <Modal
        className="account-recycle-bin-modal"
        open={open}
        centered
        width={780}
        title={t("providers.proxy.recycleBinTitle")}
        onCancel={() => setOpen(false)}
        footer={(
          <>
            <Button icon={<RefreshCw size={14} />} loading={loading} onClick={() => void refresh()}>
              {t("providers.proxy.sessionsRefresh")}
            </Button>
            <Button type="primary" onClick={() => setOpen(false)}>
              {t("providers.proxy.sessionsClose")}
            </Button>
          </>
        )}
      >
        <p className="proxy-session-description">
          {t("providers.proxy.recycleBinDescription")}
        </p>
        {error ? <Alert type="error" showIcon message={error} /> : null}
        <Table
          rowKey="id"
          size="small"
          loading={loading}
          columns={columns}
          dataSource={accounts}
          pagination={false}
          locale={{ emptyText: t("providers.proxy.recycleBinEmpty") }}
          scroll={{ y: "50vh" }}
        />
      </Modal>
    </>
  );
}
