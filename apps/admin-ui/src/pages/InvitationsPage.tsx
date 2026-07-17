import { Button, Table, Tag } from "antd";
import type { TableColumnsType } from "antd";
import { Plus, RefreshCw, XCircle } from "lucide-react";
import { labelForRole } from "../i18n";
import { useI18n } from "../i18n-context";
import type { Invitation, PageResult, RbacRole, Role } from "../types";
import { formatDate } from "../utils/format";

interface InvitationsPageProps {
  invitations: PageResult<Invitation>;
  loading: boolean;
  onCreateInvitation: () => void;
  onLoadInvitations: (page?: number, pageSize?: number) => void | Promise<void>;
  onRevokeInvitation: (invitation: Invitation) => void;
  roles: RbacRole[];
  canManage: boolean;
}

export function InvitationsPage({
  invitations,
  loading,
  onCreateInvitation,
  onLoadInvitations,
  onRevokeInvitation,
  roles,
  canManage,
}: InvitationsPageProps) {
  const { language, t } = useI18n();
  const columns: TableColumnsType<Invitation> = [
    {
      title: t("common.email"),
      dataIndex: "email",
      render: (email?: string | null) => email || t("invitations.anyEmail"),
    },
    {
      title: t("common.role"),
      dataIndex: "role",
      width: 120,
      render: (role: Role) => (
        <Tag>{roles.find((item) => item.code === role)?.name ?? labelForRole(role, t)}</Tag>
      ),
    },
    { title: t("invitations.creator"), dataIndex: "createdByEmail", width: 220 },
    {
      title: t("invitations.uses"),
      key: "uses",
      width: 110,
      render: (_, row) => `${row.usedCount}/${row.maxUses}`,
    },
    {
      title: t("common.expiresAt"),
      dataIndex: "expiresAt",
      width: 180,
      render: (value?: string | null) => value ? formatDate(value, language) : t("invitations.neverExpires"),
    },
    {
      title: t("common.status"),
      key: "status",
      width: 110,
      render: (_, row) => {
        if (row.revokedAt) return <Tag>{t("invitations.status.revoked")}</Tag>;
        if (row.usedCount >= row.maxUses) return <Tag color="green">{t("invitations.status.exhausted")}</Tag>;
        if (row.expiresAt && new Date(row.expiresAt) <= new Date()) {
          return <Tag color="orange">{t("invitations.status.expired")}</Tag>;
        }
        return <Tag color="blue">{t("invitations.status.active")}</Tag>;
      },
    },
    {
      title: t("common.actions"),
      width: 90,
      render: (_, row) => (
        <Button
          danger
          className="icon-button"
          icon={<XCircle size={15} />}
          disabled={!canManage || Boolean(row.revokedAt || row.usedCount >= row.maxUses)}
          onClick={() => onRevokeInvitation(row)}
        />
      ),
    },
  ];

  return (
    <>
      <h1 className="page-title">{t("invitations.title")}</h1>
      <div className="toolbar">
        <div />
        <div className="toolbar-right">
          <Button icon={<RefreshCw size={15} />} onClick={() => onLoadInvitations()}>{t("common.refresh")}</Button>
          {canManage && (
            <Button type="primary" icon={<Plus size={15} />} onClick={onCreateInvitation}>{t("invitations.create")}</Button>
          )}
        </div>
      </div>
      <div className="panel">
        <Table
          rowKey="id"
          loading={loading}
          columns={columns}
          dataSource={invitations.items}
          pagination={{
            current: invitations.page,
            pageSize: invitations.pageSize,
            total: invitations.total,
            showSizeChanger: true,
          }}
          onChange={(pagination) => onLoadInvitations(pagination.current, pagination.pageSize)}
          scroll={{ x: 1080 }}
        />
      </div>
    </>
  );
}
