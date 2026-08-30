import { useEffect, useState } from "react";
import { Button, Form, Input, Modal, Select, Space, Table, Tag, Typography } from "antd";
import type { TableColumnsType } from "antd";
import { Edit3, RefreshCw, Search, Trash2 } from "lucide-react";
import { useI18n } from "../i18n-context";
import type { AdminPromptPluginRow, AdminPromptPluginUpdate, PageResult } from "../types";
import { formatDate } from "../utils/format";

interface PromptPluginsPageProps {
  plugins: PageResult<AdminPromptPluginRow>;
  loading: boolean;
  search: string;
  canManage: boolean;
  onSearchChange: (value: string) => void;
  onLoad: (page?: number, pageSize?: number) => Promise<void>;
  onUpdate: (id: string, values: AdminPromptPluginUpdate) => Promise<void>;
  onDelete: (plugin: AdminPromptPluginRow) => void;
}

export function PromptPluginsPage({
  plugins,
  loading,
  search,
  canManage,
  onSearchChange,
  onLoad,
  onUpdate,
  onDelete,
}: PromptPluginsPageProps) {
  const { language, t } = useI18n();
  const [editing, setEditing] = useState<AdminPromptPluginRow | null>(null);
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm<AdminPromptPluginUpdate>();

  useEffect(() => {
    if (!editing) return;
    form.setFieldsValue({
      name: editing.name,
      version: editing.version,
      type: editing.type,
      text: editing.text,
    });
  }, [editing, form]);

  const columns: TableColumnsType<AdminPromptPluginRow> = [
    {
      title: t("promptPlugins.name"),
      dataIndex: "name",
      width: 220,
      render: (value: string, row) => (
        <Space direction="vertical" size={1} style={{ maxWidth: 200 }}>
          <Typography.Text strong ellipsis={{ tooltip: value }}>{value}</Typography.Text>
          <Typography.Text type="secondary" ellipsis={{ tooltip: row.text }}>{row.text}</Typography.Text>
        </Space>
      ),
    },
    {
      title: t("promptPlugins.type"),
      dataIndex: "type",
      width: 110,
      render: (value: AdminPromptPluginRow["type"]) => (
        <Tag color={value === "injection" ? "blue" : "orange"}>{t(`promptPlugins.type.${value}`)}</Tag>
      ),
    },
    {
      title: t("promptPlugins.version"),
      dataIndex: "version",
      width: 110,
      render: (value: string) => <Tag color="green">v{value}</Tag>,
    },
    {
      title: t("promptPlugins.publisher"),
      dataIndex: "uploaderEmail",
      width: 220,
    },
    {
      title: t("promptPlugins.downloads"),
      dataIndex: "installCount",
      width: 110,
      align: "right",
      sorter: (a, b) => a.installCount - b.installCount,
    },
    {
      title: t("promptPlugins.publishedAt"),
      dataIndex: "createdAt",
      width: 180,
      render: (value: string) => formatDate(value, language),
    },
    {
      title: t("common.actions"),
      key: "actions",
      width: 165,
      fixed: "right",
      render: (_, row) => (
        <Space>
          <Button size="small" icon={<Edit3 size={14} />} disabled={!canManage}
            onClick={() => setEditing(row)}>{t("common.edit")}</Button>
          <Button size="small" danger icon={<Trash2 size={14} />} disabled={!canManage}
            onClick={() => onDelete(row)}>{t("common.delete")}</Button>
        </Space>
      ),
    },
  ];

  return (
    <>
      <h1 className="page-title">{t("promptPlugins.title")}</h1>
      <div className="toolbar">
        <div className="toolbar-left">
          <Input allowClear value={search} prefix={<Search size={15} />}
            placeholder={t("promptPlugins.searchPlaceholder")} style={{ width: 320 }}
            onChange={(event) => onSearchChange(event.target.value)}
            onPressEnter={() => void onLoad(1, plugins.pageSize)} />
          <Button type="primary" icon={<Search size={15} />}
            onClick={() => void onLoad(1, plugins.pageSize)}>{t("common.search")}</Button>
          <Typography.Text type="secondary">{t("promptPlugins.total", { count: plugins.total })}</Typography.Text>
        </div>
        <Button icon={<RefreshCw size={15} />} onClick={() => void onLoad()}>{t("common.refresh")}</Button>
      </div>
      <div className="panel">
        <Table rowKey="id" loading={loading} columns={columns} dataSource={plugins.items}
          pagination={{
            current: plugins.page,
            pageSize: plugins.pageSize,
            total: plugins.total,
            showSizeChanger: true,
          }}
          onChange={(pagination) => void onLoad(pagination.current, pagination.pageSize)} scroll={{ x: 1120 }} />
      </div>

      <Modal title={t("promptPlugins.editTitle")} open={Boolean(editing)} confirmLoading={saving}
        okText={t("common.save")} cancelText={t("common.cancel")} onCancel={() => setEditing(null)}
        onOk={() => form.submit()} destroyOnClose>
        <Form form={form} layout="vertical" onFinish={async (values) => {
          if (!editing) return;
          setSaving(true);
          try { await onUpdate(editing.id, values); setEditing(null); } finally { setSaving(false); }
        }}>
          <Form.Item name="name" label={t("promptPlugins.name")} rules={[{ required: true, whitespace: true }]}>
            <Input maxLength={120} showCount />
          </Form.Item>
          <Form.Item name="version" label={t("promptPlugins.version")} rules={[{ required: true, whitespace: true }]}>
            <Input maxLength={40} />
          </Form.Item>
          <Form.Item name="type" label={t("promptPlugins.type")} rules={[{ required: true }]}>
            <Select options={[
              { value: "injection", label: t("promptPlugins.type.injection") },
              { value: "filter", label: t("promptPlugins.type.filter") },
            ]} />
          </Form.Item>
          <Form.Item name="text" label={t("promptPlugins.text")} rules={[{ required: true, whitespace: true }]}>
            <Input.TextArea rows={8} maxLength={5000} showCount />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
