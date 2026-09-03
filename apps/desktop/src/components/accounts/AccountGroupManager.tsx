import { useEffect, useMemo, useState } from "react";
import { Button, Empty, Input, Modal, Popconfirm, Space, Tag } from "antd";
import { FolderCog, Pencil, Plus, Save, Trash2, X } from "lucide-react";
import type { Translate } from "../../i18n";
import type { Account } from "../../types";

interface AccountGroupManagerProps {
  accounts: Account[];
  concurrentGroup: string | null;
  concurrentRoutingEnabled: boolean;
  groups: string[];
  onChangeMany: (ids: string[], group: string) => Promise<string[]>;
  onGroupsChange: (groups: string[]) => Promise<void>;
  onConcurrentRoutingChange: (enabled: boolean, group: string | null) => Promise<void>;
  t: Translate;
}

export function AccountGroupManager(options: AccountGroupManagerProps) {
  const [open, setOpen] = useState(false);
  const [newGroup, setNewGroup] = useState("");
  const [editingGroup, setEditingGroup] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [busyGroup, setBusyGroup] = useState<string | null>(null);
  const groups = useMemo(() => [...new Set([
    ...options.groups,
    ...options.accounts.map((account) => account.group),
  ].filter(Boolean))], [options.accounts, options.groups]);
  const normalizedNewGroup = newGroup.trim();
  const duplicateNewGroup = groups.includes(normalizedNewGroup);

  useEffect(() => {
    if (editingGroup && !groups.includes(editingGroup)) setEditingGroup(null);
  }, [editingGroup, groups]);

  const membersOf = (group: string) => options.accounts.filter((account) => account.group === group);
  const saveCatalog = async (nextGroups: string[], busyKey: string) => {
    setBusyGroup(busyKey);
    try {
      await options.onGroupsChange(nextGroups);
    } finally {
      setBusyGroup(null);
    }
  };
  const createGroup = async () => {
    if (!normalizedNewGroup || duplicateNewGroup) return;
    await saveCatalog([...groups, normalizedNewGroup], "new");
    setNewGroup("");
  };
  const renameGroup = async (group: string) => {
    const nextName = editingName.trim();
    if (!nextName || (nextName !== group && groups.includes(nextName))) return;
    if (nextName === group) return setEditingGroup(null);
    setBusyGroup(group);
    try {
      const memberIds = membersOf(group).map(({ id }) => id);
      const changedIds = await options.onChangeMany(memberIds, nextName);
      if (changedIds.length !== memberIds.length) return;
      if (options.concurrentGroup === group) {
        await options.onConcurrentRoutingChange(options.concurrentRoutingEnabled, nextName);
      }
      await options.onGroupsChange(groups.map((item) => item === group ? nextName : item));
      setEditingGroup(null);
    } finally {
      setBusyGroup(null);
    }
  };
  const deleteGroup = async (group: string) => {
    setBusyGroup(group);
    try {
      const memberIds = membersOf(group).map(({ id }) => id);
      const changedIds = await options.onChangeMany(memberIds, "");
      if (changedIds.length !== memberIds.length) return;
      if (options.concurrentGroup === group) {
        await options.onConcurrentRoutingChange(options.concurrentRoutingEnabled, null);
      }
      await options.onGroupsChange(groups.filter((item) => item !== group));
    } finally {
      setBusyGroup(null);
    }
  };

  return <>
    <Button className="refresh-all proxy-topbar-action" icon={<FolderCog size={14} />}
      onClick={() => setOpen(true)}>{options.t("accounts.group.manage")}</Button>
    <Modal open={open} width={520} title={options.t("accounts.group.manageTitle")} footer={null}
      onCancel={() => !busyGroup && setOpen(false)} maskClosable={!busyGroup}>
      <p className="account-group-manager-description">{options.t("accounts.group.manageDescription")}</p>
      <Space.Compact block className="account-group-create-row">
        <Input value={newGroup} maxLength={80} status={duplicateNewGroup ? "error" : undefined}
          placeholder={options.t("accounts.group.newPlaceholder")}
          onChange={(event) => setNewGroup(event.target.value)} onPressEnter={() => void createGroup()} />
        <Button type="primary" icon={<Plus size={14} />} loading={busyGroup === "new"}
          disabled={Boolean(busyGroup) || !normalizedNewGroup || duplicateNewGroup}
          onClick={() => void createGroup()}>{options.t("accounts.group.add")}</Button>
      </Space.Compact>
      <div className="account-group-manager-list">
        {!groups.length && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={options.t("accounts.group.empty")} />}
        {groups.map((group) => {
          const editing = editingGroup === group;
          const memberCount = membersOf(group).length;
          const nextName = editingName.trim();
          const duplicateName = nextName !== group && groups.includes(nextName);
          return <div className="account-group-manager-row" key={group}>
            {editing ? <Input value={editingName} maxLength={80} status={duplicateName ? "error" : undefined}
              onChange={(event) => setEditingName(event.target.value)}
              onPressEnter={() => void renameGroup(group)} /> : <strong>{group}</strong>}
            <Tag bordered={false}>{options.t("accounts.group.memberCount", { count: memberCount })}</Tag>
            <Space size={4}>{editing ? <>
              <Button size="small" className="table-icon-button" icon={<Save size={14} />}
                aria-label={options.t("accounts.group.save")} loading={busyGroup === group}
                disabled={Boolean(busyGroup) || !nextName || duplicateName}
                onClick={() => void renameGroup(group)} />
              <Button size="small" className="table-icon-button" icon={<X size={14} />}
                aria-label={options.t("table.cancel")} disabled={Boolean(busyGroup)}
                onClick={() => setEditingGroup(null)} />
            </> : <>
              <Button size="small" className="table-icon-button" icon={<Pencil size={14} />}
                aria-label={options.t("accounts.group.rename")} disabled={Boolean(busyGroup)}
                onClick={() => { setEditingGroup(group); setEditingName(group); }} />
              <Popconfirm title={options.t("accounts.group.deleteTitle", { group })}
                description={options.t("accounts.group.deleteDescription")}
                okText={options.t("accounts.group.delete")} cancelText={options.t("table.cancel")}
                okButtonProps={{ danger: true }} disabled={Boolean(busyGroup)}
                onConfirm={() => deleteGroup(group)}>
                <Button danger size="small" className="table-icon-button" icon={<Trash2 size={14} />}
                  aria-label={options.t("accounts.group.delete")} loading={busyGroup === group}
                  disabled={Boolean(busyGroup)} />
              </Popconfirm>
            </>}</Space>
          </div>;
        })}
      </div>
    </Modal>
  </>;
}
