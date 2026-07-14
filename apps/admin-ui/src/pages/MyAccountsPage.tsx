import { Badge, Button, Table, Tag, Typography } from "antd";
import type { TableColumnsType } from "antd";
import { RefreshCw } from "lucide-react";
import { useI18n } from "../i18n-context";
import type { SyncAccount } from "../types";
import { formatDate } from "../utils/format";

interface MyAccountsPageProps {
  accounts: SyncAccount[];
  loading: boolean;
  onRefresh: () => void | Promise<void>;
}

export function MyAccountsPage({ accounts, loading, onRefresh }: MyAccountsPageProps) {
  const { language, t } = useI18n();
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
    { title: t("common.note"), dataIndex: "note", ellipsis: true, render: (value) => value || "-" },
    { title: t("common.expiresAt"), dataIndex: "expiresAt", width: 130, render: (value) => value || "-" },
    {
      title: t("common.lastModifiedAt"),
      dataIndex: "lastModifiedAt",
      width: 180,
      render: (value) => formatDate(value, language),
    },
  ];

  return (
    <>
      <h1 className="page-title">{t("myAccounts.title")}</h1>
      <div className="toolbar">
        <div />
        <Button icon={<RefreshCw size={15} />} onClick={() => onRefresh()}>
          {t("common.refresh")}
        </Button>
      </div>
      <div className="panel">
        <Table
          rowKey="id"
          loading={loading}
          columns={columns}
          dataSource={accounts}
          pagination={false}
          scroll={{ x: 1000 }}
        />
      </div>
    </>
  );
}
