import { useEffect, useMemo, useState } from "react";
import { App as AntApp, Input, Modal, Table, Tag, Typography } from "antd";
import type { TableColumnsType } from "antd";
import { Search } from "lucide-react";
import { useI18n } from "../../i18n-context";
import type { ApiClient, SystemAccount, UserRow } from "../../types";

interface BatchBindSystemAccountsModalProps {
  api: ApiClient;
  users: UserRow[];
  accounts: SystemAccount[];
  loading: boolean;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}

export function BatchBindSystemAccountsModal({
  accounts,
  api,
  loading,
  users,
  onClose,
  onSaved,
}: BatchBindSystemAccountsModalProps) {
  const { message } = AntApp.useApp();
  const { t } = useI18n();
  const [selectedIds, setSelectedIds] = useState<React.Key[]>([]);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");

  useEffect(() => {
    setSelectedIds([]);
    setSearch("");
  }, [users]);
  const filteredAccounts = useMemo(() => {
    const term = search.trim().toLocaleLowerCase();
    if (!term) return accounts;
    return accounts.filter((account) => (
      account.email.toLocaleLowerCase().includes(term)
      || account.plan.toLocaleLowerCase().includes(term)
      || account.note.toLocaleLowerCase().includes(term)
    ));
  }, [accounts, search]);
  const columns = useMemo<TableColumnsType<SystemAccount>>(() => [
    { title: t("common.email"), dataIndex: "email" },
    { title: t("common.plan"), dataIndex: "plan", width: 120, render: (value) => <Tag>{value}</Tag> },
    { title: t("common.note"), dataIndex: "note", ellipsis: true, render: (value) => value || "-" },
    { title: t("officialAccounts.boundUsers"), dataIndex: "boundUserCount", width: 120 },
  ], [t]);

  async function save() {
    if (!selectedIds.length) {
      message.warning(t("officialAccounts.selectAccount"));
      return;
    }
    setSaving(true);
    try {
      await api("/admin/api/official-accounts/bind", {
        method: "POST",
        body: JSON.stringify({
          systemAccountIds: selectedIds.map(String),
          userIds: users.map((user) => user.id),
        }),
      });
      message.success(t("officialAccounts.batchBound", { accounts: selectedIds.length, users: users.length }));
      onClose();
      await onSaved();
    } catch (error) {
      message.error((error as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      title={t("officialAccounts.batchBindTitle", { count: users.length })}
      open={users.length > 0}
      onCancel={onClose}
      onOk={save}
      confirmLoading={saving}
      width={760}
      destroyOnClose
    >
      <Typography.Paragraph type="secondary">
        {users.map((user) => user.email).join(", ")}
      </Typography.Paragraph>
      <Input
        allowClear
        prefix={<Search size={15} />}
        placeholder={t("officialAccounts.searchAccountsPlaceholder")}
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        style={{ marginBottom: 12 }}
      />
      <Table
        rowKey="id"
        loading={loading}
        columns={columns}
        dataSource={filteredAccounts}
        rowSelection={{
          selectedRowKeys: selectedIds,
          onChange: setSelectedIds,
          preserveSelectedRowKeys: true,
        }}
        pagination={{ pageSize: 10, showSizeChanger: true }}
        scroll={{ y: 380 }}
      />
    </Modal>
  );
}
