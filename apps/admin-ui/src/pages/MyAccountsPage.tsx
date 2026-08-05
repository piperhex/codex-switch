import { useEffect, useMemo, useState } from "react";
import { Badge, Button, Modal, Table, Tag, Tooltip, Typography } from "antd";
import type { TableColumnsType } from "antd";
import type { Key } from "react";
import { DatabaseZap, ListChecks, Pencil, RefreshCw } from "lucide-react";
import { useI18n } from "../i18n-context";
import type { SyncAccount } from "../types";
import { formatDate } from "../utils/format";

interface MyAccountsPageProps {
  accounts: SyncAccount[];
  loading: boolean;
  onEdit: (account: SyncAccount) => void;
  onAddToPool: (account: SyncAccount) => void;
  onAddAccountsToPool: (accounts: SyncAccount[], mode: "all" | "selected") => void;
  onRefresh: () => void | Promise<void>;
  canEditPersonal: boolean;
  canEditOfficial: boolean;
  canRecordToPool: boolean;
  recordingToPool: boolean;
}

export function MyAccountsPage({
  accounts,
  canEditOfficial,
  canEditPersonal,
  canRecordToPool,
  loading,
  onAddAccountsToPool,
  onAddToPool,
  onEdit,
  onRefresh,
  recordingToPool,
}: MyAccountsPageProps) {
  const { language, t } = useI18n();
  const [noteAccount, setNoteAccount] = useState<SyncAccount | null>(null);
  const [selectedRowKeys, setSelectedRowKeys] = useState<Key[]>([]);
  const recordableAccounts = useMemo(
    () => accounts.filter((account) => account.source === "personal" && !account.inSystemPool),
    [accounts],
  );
  const recordableAccountIds = useMemo(
    () => new Set(recordableAccounts.map((account) => account.id)),
    [recordableAccounts],
  );
  const selectedAccounts = useMemo(
    () => recordableAccounts.filter((account) => selectedRowKeys.includes(account.id)),
    [recordableAccounts, selectedRowKeys],
  );

  useEffect(() => {
    setSelectedRowKeys((current) => current.filter((key) => recordableAccountIds.has(String(key))));
  }, [recordableAccountIds]);

  const columns: TableColumnsType<SyncAccount> = [
    {
      title: t("common.email"),
      dataIndex: "email",
      render: (email: string, account) => (
        <div>
          <Typography.Text strong>{email}</Typography.Text>
          <br />
          <Typography.Text type="secondary" copyable={{ text: account.id }}>
            {account.id}
          </Typography.Text>
        </div>
      ),
    },
    {
      title: t("common.plan"),
      dataIndex: "plan",
      width: 120,
      render: (plan: string) => <Tag>{plan || "ChatGPT"}</Tag>,
    },
    {
      title: t("accounts.source"),
      dataIndex: "source",
      width: 120,
      render: (source: SyncAccount["source"]) => (
        <Tag color={source === "system" ? "blue" : "default"}>
          {t(source === "system" ? "accounts.sourceSystem" : "accounts.sourcePersonal")}
        </Tag>
      ),
    },
    {
      title: t("common.status"),
      dataIndex: "active",
      width: 100,
      render: (active: boolean) => (
        <Badge
          status={active ? "processing" : "default"}
          text={t(active ? "accounts.active" : "accounts.inactive")}
        />
      ),
    },
    {
      title: t("common.note"),
      dataIndex: "note",
      ellipsis: true,
      render: (value: string, account) => value ? (
        <Button
          type="link"
          onClick={() => setNoteAccount(account)}
          style={{ display: "block", width: "100%", height: "auto", padding: 0, textAlign: "left" }}
        >
          <span style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis" }}>
            {value}
          </span>
        </Button>
      ) : "-",
    },
    { title: t("common.expiresAt"), dataIndex: "expiresAt", width: 130, render: (value) => value || "-" },
    {
      title: t("common.lastModifiedAt"),
      dataIndex: "lastModifiedAt",
      width: 180,
      render: (value) => formatDate(value, language),
    },
    {
      title: t("common.actions"),
      key: "actions",
      width: 220,
      fixed: "right",
      align: "center",
      render: (_, account) => {
        const canEdit = account.source === "system" ? canEditOfficial : canEditPersonal;
        const editButton = (
          <Button
            type="link"
            size="small"
            icon={<Pencil size={14} />}
            disabled={!canEdit}
            onClick={() => onEdit(account)}
          >
            {t("common.edit")}
          </Button>
        );
        return account.source === "system" && !canEdit ? (
          <Tooltip title={t("accounts.systemMetadataPermissionRequired")}>
            <span>{editButton}</span>
          </Tooltip>
        ) : (
          <div className="table-actions">
            {canRecordToPool && !account.inSystemPool && (
              <Button
                type="link"
                size="small"
                icon={<DatabaseZap size={14} />}
                disabled={recordingToPool}
                onClick={() => onAddToPool(account)}
              >
                {t("accounts.recordToPool")}
              </Button>
            )}
            {account.inSystemPool && <Tag color="green">{t("accounts.recordedInPool")}</Tag>}
            {editButton}
          </div>
        );
      },
    },
  ];

  return (
    <>
      <h1 className="page-title">{t("myAccounts.title")}</h1>
      <div className="toolbar">
        <div />
        <div className="toolbar-right">
          <Button icon={<RefreshCw size={15} />} onClick={() => onRefresh()}>
            {t("common.refresh")}
          </Button>
          {canRecordToPool && (
            <>
              <Button
                icon={<DatabaseZap size={15} />}
                disabled={!recordableAccounts.length || recordingToPool}
                loading={recordingToPool}
                onClick={() => onAddAccountsToPool(recordableAccounts, "all")}
              >
                {t("accounts.recordAllToPool")}
              </Button>
              <Button
                type="primary"
                icon={<ListChecks size={15} />}
                disabled={!selectedAccounts.length || recordingToPool}
                onClick={() => onAddAccountsToPool(selectedAccounts, "selected")}
              >
                {t("accounts.recordSelectedToPool", { count: selectedAccounts.length })}
              </Button>
            </>
          )}
        </div>
      </div>
      <div className="panel">
        <Table
          rowKey="id"
          loading={loading}
          columns={columns}
          dataSource={accounts}
          rowSelection={canRecordToPool ? {
            selectedRowKeys,
            onChange: setSelectedRowKeys,
            getCheckboxProps: (account) => ({
              disabled: account.source === "system" || Boolean(account.inSystemPool) || recordingToPool,
            }),
          } : undefined}
          pagination={false}
          scroll={{ x: 1120 }}
        />
      </div>
      <Modal
        title={t("accounts.noteDetailsTitle")}
        open={Boolean(noteAccount)}
        onCancel={() => setNoteAccount(null)}
        footer={(
          <Button type="primary" onClick={() => setNoteAccount(null)}>
            {t("common.close")}
          </Button>
        )}
        width={680}
      >
        <Typography.Text type="secondary">{noteAccount?.email}</Typography.Text>
        <Typography.Paragraph
          copyable={noteAccount ? { text: noteAccount.note } : false}
          style={{ marginTop: 16, maxHeight: "60vh", overflow: "auto", whiteSpace: "pre-wrap", wordBreak: "break-word" }}
        >
          {noteAccount?.note}
        </Typography.Paragraph>
      </Modal>
    </>
  );
}
