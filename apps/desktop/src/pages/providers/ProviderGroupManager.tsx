import { useEffect, useMemo, useState } from "react";
import { Button, Empty, Input, Modal, Popconfirm, Space, Tag } from "antd";
import { FolderCog, Pencil, Plus, Save, Trash2, X } from "lucide-react";
import type { Translate } from "../../i18n";
import type { Provider } from "../../types";

interface ProviderGroupManagerProps {
  groups: string[];
  providers: Provider[];
  busy: boolean;
  onChangeMany: (ids: string[], group: string) => Promise<string[]>;
  onGroupsChange: (groups: string[]) => Promise<void>;
  t: Translate;
}

export function ProviderGroupManager(options: ProviderGroupManagerProps) {
  const [open, setOpen] = useState(false);
  const [newGroup, setNewGroup] = useState("");
  const [editingGroup, setEditingGroup] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [busyGroup, setBusyGroup] = useState<string | null>(null);
  const groups = useMemo(() => [...new Set([
    ...options.groups,
    ...options.providers.filter((provider) => provider.kind === "custom").map((provider) => provider.group),
  ].filter(Boolean))], [options.groups, options.providers]);
  const changing = options.busy || busyGroup !== null;
  const normalizedNewGroup = newGroup.trim();
  const duplicateNewGroup = groups.includes(normalizedNewGroup);

  useEffect(() => {
    if (editingGroup && !groups.includes(editingGroup)) setEditingGroup(null);
  }, [editingGroup, groups]);

  const membersOf = (group: string) => options.providers.filter(
    (provider) => provider.kind === "custom" && provider.group === group,
  );
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
  const beginRename = (group: string) => {
    setEditingGroup(group);
    setEditingName(group);
  };
  const renameGroup = async (group: string) => {
    const nextName = editingName.trim();
    if (!nextName || (nextName !== group && groups.includes(nextName))) return;
    if (nextName === group) {
      setEditingGroup(null);
      return;
    }
    setBusyGroup(group);
    try {
      const memberIds = membersOf(group).map(({ id }) => id);
      const changedIds = memberIds.length ? await options.onChangeMany(memberIds, nextName) : [];
      if (memberIds.length && changedIds.length !== memberIds.length) return;
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
      const changedIds = memberIds.length ? await options.onChangeMany(memberIds, "") : [];
      if (memberIds.length && changedIds.length !== memberIds.length) return;
      await options.onGroupsChange(groups.filter((item) => item !== group));
    } finally {
      setBusyGroup(null);
    }
  };

  return <>
    <Button className="provider-topbar-button" icon={<FolderCog size={14} />} onClick={() => setOpen(true)}>
      {options.t("providers.group.manage")}
    </Button>
    <Modal open={open} width={520} title={options.t("providers.group.manageTitle")} footer={null}
      onCancel={() => !changing && setOpen(false)} maskClosable={!changing}>
      <p className="provider-group-manager-description">{options.t("providers.group.manageDescription")}</p>
      <Space.Compact block className="provider-group-create-row">
        <Input value={newGroup} maxLength={80} status={duplicateNewGroup ? "error" : undefined}
          placeholder={options.t("providers.group.newPlaceholder")}
          onChange={(event) => setNewGroup(event.target.value)}
          onPressEnter={() => void createGroup()} />
        <Button type="primary" icon={<Plus size={14} />} loading={busyGroup === "new"}
          disabled={changing || !normalizedNewGroup || duplicateNewGroup}
          onClick={() => void createGroup()}>{options.t("providers.group.add")}</Button>
      </Space.Compact>
      <div className="provider-group-manager-list">
        {!groups.length && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={options.t("providers.group.empty")} />}
        {groups.map((group) => {
          const editing = editingGroup === group;
          const memberCount = membersOf(group).length;
          const nextName = editingName.trim();
          const duplicateName = nextName !== group && groups.includes(nextName);
          return <div className="provider-group-manager-row" key={group}>
            {editing ? <Input value={editingName} maxLength={80} status={duplicateName ? "error" : undefined}
              onChange={(event) => setEditingName(event.target.value)}
              onPressEnter={() => void renameGroup(group)} /> : <strong>{group}</strong>}
            <Tag bordered={false}>{options.t("providers.group.memberCount", { count: memberCount })}</Tag>
            <Space size={4}>
              {editing ? <>
                <Button size="small" className="table-icon-button" aria-label={options.t("providers.group.save")}
                  icon={<Save size={14} />} loading={busyGroup === group}
                  disabled={changing || !nextName || duplicateName}
                  onClick={() => void renameGroup(group)} />
                <Button size="small" className="table-icon-button" aria-label={options.t("providers.form.cancel")}
                  icon={<X size={14} />} disabled={changing} onClick={() => setEditingGroup(null)} />
              </> : <>
                <Button size="small" className="table-icon-button" aria-label={options.t("providers.group.rename")}
                  icon={<Pencil size={14} />} disabled={changing} onClick={() => beginRename(group)} />
                <Popconfirm title={options.t("providers.group.deleteTitle", { group })}
                  description={<span className="provider-batch-group-confirm">
                    {options.t("providers.group.deleteDescription")}
                  </span>}
                  okText={options.t("providers.group.delete")} cancelText={options.t("providers.form.cancel")}
                  okButtonProps={{ danger: true }} disabled={changing}
                  onConfirm={() => deleteGroup(group)}>
                  <Button danger size="small" className="table-icon-button"
                    aria-label={options.t("providers.group.delete")} icon={<Trash2 size={14} />}
                    loading={busyGroup === group} disabled={changing} />
                </Popconfirm>
              </>}
            </Space>
          </div>;
        })}
      </div>
    </Modal>
  </>;
}
