import { useState } from "react";
import { App as AntApp, Button, Modal, Space, Table, Tag, Typography } from "antd";
import type { TableColumnsType } from "antd";
import { Eye, Plus, RefreshCw, XCircle } from "lucide-react";
import { labelForRole } from "../i18n";
import { useI18n } from "../i18n-context";
import type { Invitation, InvitationRegisteredUser, PageResult, RbacRole, Role } from "../types";
import { formatDate } from "../utils/format";

interface InvitationsPageProps {
  invitations: PageResult<Invitation>;
  loading: boolean;
  onCreateInvitation: () => void;
  onLoadInvitations: (page?: number, pageSize?: number) => void | Promise<void>;
  onLoadInvitationUsers: (
    invitationId: string,
    page?: number,
    pageSize?: number,
  ) => Promise<PageResult<InvitationRegisteredUser>>;
  onRevokeInvitation: (invitation: Invitation) => void;
  roles: RbacRole[];
  canManage: boolean;
}

export function InvitationsPage({
  invitations,
  loading,
  onCreateInvitation,
  onLoadInvitations,
  onLoadInvitationUsers,
  onRevokeInvitation,
  roles,
  canManage,
}: InvitationsPageProps) {
  const { message } = AntApp.useApp();
  const { language, t } = useI18n();
  const [selectedInvitation, setSelectedInvitation] = useState<Invitation | null>(null);
  const [registeredUsers, setRegisteredUsers] = useState<PageResult<InvitationRegisteredUser>>({
    items: [],
    total: 0,
    page: 1,
    pageSize: 20,
  });
  const [registeredUsersLoading, setRegisteredUsersLoading] = useState(false);

  async function loadRegisteredUsers(invitation: Invitation, page = 1, pageSize = 20) {
    setRegisteredUsersLoading(true);
    try {
      setRegisteredUsers(await onLoadInvitationUsers(invitation.id, page, pageSize));
    } catch (error) {
      message.error((error as Error).message);
    } finally {
      setRegisteredUsersLoading(false);
    }
  }

  function openRegisteredUsers(invitation: Invitation) {
    setSelectedInvitation(invitation);
    setRegisteredUsers({ items: [], total: 0, page: 1, pageSize: 20 });
    void loadRegisteredUsers(invitation);
  }

  const registeredUserColumns: TableColumnsType<InvitationRegisteredUser> = [
    { title: t("common.email"), dataIndex: "email" },
    {
      title: t("common.role"),
      dataIndex: "role",
      width: 140,
      render: (role: Role) => (
        <Tag>{roles.find((item) => item.code === role)?.name ?? labelForRole(role, t)}</Tag>
      ),
    },
    {
      title: t("invitations.registeredAt"),
      dataIndex: "registeredAt",
      width: 190,
      render: (value: string) => formatDate(value, language),
    },
  ];

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
      key: "actions",
      width: 160,
      fixed: "right",
      render: (_, row) => (
        <Space size="small">
          <Button size="small" icon={<Eye size={14} />} onClick={() => openRegisteredUsers(row)}>
            {t("invitations.viewUsers")}
          </Button>
          <Button
            danger
            size="small"
            className="icon-button"
            icon={<XCircle size={15} />}
            disabled={!canManage || Boolean(row.revokedAt || row.usedCount >= row.maxUses)}
            onClick={() => onRevokeInvitation(row)}
          />
        </Space>
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
          scroll={{ x: 1160 }}
        />
      </div>

      <Modal
        title={t("invitations.usersTitle")}
        open={Boolean(selectedInvitation)}
        width={760}
        footer={null}
        onCancel={() => setSelectedInvitation(null)}
        destroyOnClose
      >
        <Typography.Paragraph type="secondary">
          {t("invitations.registeredUsersCount", { count: registeredUsers.total })}
        </Typography.Paragraph>
        <Table
          rowKey="id"
          size="small"
          loading={registeredUsersLoading}
          columns={registeredUserColumns}
          dataSource={registeredUsers.items}
          locale={{ emptyText: t("invitations.noRegisteredUsers") }}
          pagination={{
            current: registeredUsers.page,
            pageSize: registeredUsers.pageSize,
            total: registeredUsers.total,
            showSizeChanger: true,
          }}
          onChange={(pagination) => {
            if (selectedInvitation) {
              void loadRegisteredUsers(
                selectedInvitation,
                pagination.current,
                pagination.pageSize,
              );
            }
          }}
        />
      </Modal>
    </>
  );
}
