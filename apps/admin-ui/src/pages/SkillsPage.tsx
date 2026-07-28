import { useEffect, useState } from "react";
import {
  Button,
  Form,
  Image,
  Input,
  Modal,
  Space,
  Table,
  Tag,
  Typography,
} from "antd";
import type { TableColumnsType } from "antd";
import {
  Download,
  Edit3,
  ImageOff,
  RefreshCw,
  Search,
  Trash2,
} from "lucide-react";
import { useI18n } from "../i18n-context";
import type {
  AdminSkillRow,
  AdminSkillUpdate,
  PageResult,
} from "../types";
import { formatDate } from "../utils/format";

interface SkillsPageProps {
  skills: PageResult<AdminSkillRow>;
  loading: boolean;
  search: string;
  canManage: boolean;
  onSearchChange: (value: string) => void;
  onLoad: (page?: number, pageSize?: number) => Promise<void>;
  onUpdate: (id: string, values: AdminSkillUpdate) => Promise<void>;
  onDelete: (skill: AdminSkillRow) => void;
}

function formatBytes(value: number) {
  if (value < 1024) return `${value} B`;
  return `${(value / 1024).toFixed(value < 10 * 1024 ? 1 : 0)} KB`;
}

export function SkillsPage({
  skills,
  loading,
  search,
  canManage,
  onSearchChange,
  onLoad,
  onUpdate,
  onDelete,
}: SkillsPageProps) {
  const { language, t } = useI18n();
  const [editing, setEditing] = useState<AdminSkillRow | null>(null);
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm<AdminSkillUpdate>();

  useEffect(() => {
    if (!editing) return;
    form.setFieldsValue({
      title: editing.title,
      description: editing.description,
      version: editing.version,
    });
  }, [editing, form]);

  const columns: TableColumnsType<AdminSkillRow> = [
    {
      title: t("skills.preview"),
      dataIndex: "hasPreview",
      width: 92,
      align: "center",
      render: (hasPreview: boolean, row) => hasPreview ? (
        <Image
          width={64}
          height={42}
          style={{ borderRadius: 6, objectFit: "cover" }}
          src={`/skills/${encodeURIComponent(row.id)}/preview`}
          fallback=""
        />
      ) : <ImageOff size={20} color="#98a29c" />,
    },
    {
      title: t("skills.name"),
      dataIndex: "title",
      width: 260,
      render: (value: string, row) => (
        <Space direction="vertical" size={1} style={{ maxWidth: 240 }}>
          <Typography.Text strong ellipsis={{ tooltip: value }}>{value}</Typography.Text>
          <Typography.Text type="secondary" ellipsis={{ tooltip: row.description }}>
            {row.description}
          </Typography.Text>
        </Space>
      ),
    },
    {
      title: t("skills.publisher"),
      dataIndex: "uploaderEmail",
      width: 230,
      render: (value: string, row) => (
        <Space direction="vertical" size={1}>
          <Typography.Text>{value}</Typography.Text>
          {row.uploaderId && (
            <Typography.Text type="secondary" copyable={{ text: row.uploaderId }}>
              {row.uploaderId.slice(0, 8)}
            </Typography.Text>
          )}
        </Space>
      ),
    },
    {
      title: t("skills.version"),
      dataIndex: "version",
      width: 110,
      render: (value: string) => <Tag color="green">v{value}</Tag>,
    },
    {
      title: t("skills.downloads"),
      dataIndex: "installCount",
      width: 120,
      align: "right",
      sorter: (a, b) => a.installCount - b.installCount,
      render: (value: number) => (
        <Space size={5}><Download size={14} />{value.toLocaleString()}</Space>
      ),
    },
    {
      title: t("skills.package"),
      dataIndex: "archiveSize",
      width: 150,
      render: (value: number, row) => (
        <Space direction="vertical" size={1}>
          <Typography.Text ellipsis={{ tooltip: row.archiveFileName }} style={{ maxWidth: 130 }}>
            {row.archiveFileName}
          </Typography.Text>
          <Typography.Text type="secondary">{formatBytes(value)}</Typography.Text>
        </Space>
      ),
    },
    {
      title: t("skills.publishedAt"),
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
      <h1 className="page-title">{t("skills.title")}</h1>
      <div className="toolbar">
        <div className="toolbar-left">
          <Input
            allowClear
            value={search}
            prefix={<Search size={15} />}
            placeholder={t("skills.searchPlaceholder")}
            style={{ width: 320 }}
            onChange={(event) => onSearchChange(event.target.value)}
            onPressEnter={() => void onLoad(1, skills.pageSize)}
          />
          <Button type="primary" icon={<Search size={15} />}
            onClick={() => void onLoad(1, skills.pageSize)}>{t("common.search")}</Button>
          <Typography.Text type="secondary">
            {t("skills.total", { count: skills.total })}
          </Typography.Text>
        </div>
        <Button icon={<RefreshCw size={15} />} onClick={() => void onLoad()}>
          {t("common.refresh")}
        </Button>
      </div>
      <div className="panel">
        <Table
          rowKey="id"
          loading={loading}
          columns={columns}
          dataSource={skills.items}
          pagination={{
            current: skills.page,
            pageSize: skills.pageSize,
            total: skills.total,
            showSizeChanger: true,
          }}
          onChange={(pagination) => void onLoad(pagination.current, pagination.pageSize)}
          scroll={{ x: 1420 }}
        />
      </div>

      <Modal
        title={t("skills.editTitle")}
        open={Boolean(editing)}
        confirmLoading={saving}
        okText={t("common.save")}
        cancelText={t("common.cancel")}
        onCancel={() => setEditing(null)}
        onOk={() => form.submit()}
        destroyOnClose
      >
        <Form
          form={form}
          layout="vertical"
          onFinish={async (values) => {
            if (!editing) return;
            setSaving(true);
            try {
              await onUpdate(editing.id, values);
              setEditing(null);
            } finally {
              setSaving(false);
            }
          }}
        >
          <Form.Item name="title" label={t("skills.name")}
            rules={[{ required: true, whitespace: true }]}>
            <Input maxLength={120} showCount />
          </Form.Item>
          <Form.Item name="version" label={t("skills.version")}
            rules={[{ required: true, whitespace: true }]}>
            <Input maxLength={40} />
          </Form.Item>
          <Form.Item name="description" label={t("skills.description")}
            rules={[{ required: true, whitespace: true }]}>
            <Input.TextArea rows={5} maxLength={1000} showCount />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
