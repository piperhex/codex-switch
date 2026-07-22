import { useEffect, useMemo, useState } from "react";
import {
  Button,
  Descriptions,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Select,
  Space,
  Switch,
  Table,
  Tabs,
  Tag,
  Typography,
} from "antd";
import type { TableColumnsType } from "antd";
import { Edit3, Plus, RefreshCw, Trash2 } from "lucide-react";
import { useI18n } from "../i18n-context";
import type { EmailTemplate, MailServiceConfig, MailServiceInput } from "../types";
import { formatDate } from "../utils/format";

interface EmailTemplatesPageProps {
  templates: EmailTemplate[];
  loading: boolean;
  saving: boolean;
  canManage: boolean;
  canManageMailServices: boolean;
  mailServices: MailServiceConfig[];
  mailServicesLoading: boolean;
  mailServiceSaving: boolean;
  onRefresh: () => void | Promise<void>;
  onRefreshMailServices: () => void | Promise<void>;
  onSave: (
    code: string,
    subject: string,
    body: string,
    mailServiceId?: string | null,
  ) => Promise<void>;
  onSaveMailService: (id: string | null, values: MailServiceInput) => Promise<void>;
  onDeleteMailService: (id: string) => Promise<void>;
}

interface TemplateForm {
  subject: string;
  body: string;
  mailServiceId: string;
}

interface MailServiceForm extends MailServiceInput {
  password: string;
}

function renderPreview(value: string, template: EmailTemplate | null) {
  if (!template) return value;
  const examples = new Map(template.variables.map((variable) => [variable.key, variable.example]));
  return value.replace(/{{\s*([a-zA-Z][a-zA-Z0-9]*)\s*}}/g, (placeholder, key: string) => (
    examples.get(key) ?? placeholder
  ));
}

export function EmailTemplatesPage({
  templates,
  loading,
  saving,
  canManage,
  canManageMailServices,
  mailServices,
  mailServicesLoading,
  mailServiceSaving,
  onRefresh,
  onRefreshMailServices,
  onSave,
  onSaveMailService,
  onDeleteMailService,
}: EmailTemplatesPageProps) {
  const { language, t } = useI18n();
  const [editing, setEditing] = useState<EmailTemplate | null>(null);
  const [mailModalOpen, setMailModalOpen] = useState(false);
  const [editingMailService, setEditingMailService] = useState<MailServiceConfig | null>(null);
  const [form] = Form.useForm<TemplateForm>();
  const [mailForm] = Form.useForm<MailServiceForm>();
  const subject = Form.useWatch("subject", form) ?? "";
  const body = Form.useWatch("body", form) ?? "";

  useEffect(() => {
    if (!editing) return;
    form.setFieldsValue({
      subject: editing.subject,
      body: editing.body,
      mailServiceId: editing.mailServiceId ?? "default",
    });
  }, [editing, form]);

  useEffect(() => {
    if (!mailModalOpen) return;
    mailForm.setFieldsValue(editingMailService ? {
      name: editingMailService.name,
      host: editingMailService.host,
      port: editingMailService.port,
      secure: editingMailService.secure,
      username: editingMailService.username,
      password: "",
      fromAddress: editingMailService.fromAddress,
      enabled: editingMailService.enabled,
    } : {
      name: "",
      host: "",
      port: 465,
      secure: true,
      username: "",
      password: "",
      fromAddress: "",
      enabled: true,
    });
  }, [editingMailService, mailForm, mailModalOpen]);

  const serviceOptions = mailServices.map((service) => ({
    value: service.id ?? "default",
    label: service.source === "default"
      ? `${t("mailServices.default")} · ${service.fromAddress || t("mailServices.notConfigured")}`
      : `${service.name} · ${service.fromAddress}`,
    disabled: !service.enabled,
  }));

  const templateColumns = useMemo<TableColumnsType<EmailTemplate>>(() => [
    {
      title: t("emailTemplates.type"),
      key: "type",
      render: (_, template) => (
        <Space direction="vertical" size={1}>
          <Typography.Text strong>{template.name}</Typography.Text>
          <Typography.Text type="secondary" code>{template.code}</Typography.Text>
        </Space>
      ),
    },
    { title: t("emailTemplates.subject"), dataIndex: "subject", ellipsis: true },
    {
      title: t("mailServices.sender"),
      dataIndex: "mailServiceId",
      width: 190,
      render: (serviceId: string | null) => serviceId
        ? mailServices.find((service) => service.id === serviceId)?.name ?? serviceId
        : t("mailServices.default"),
    },
    {
      title: t("emailTemplates.status"),
      dataIndex: "customized",
      width: 120,
      render: (customized: boolean) => (
        <Tag color={customized ? "blue" : "default"}>
          {t(customized ? "emailTemplates.customized" : "emailTemplates.default")}
        </Tag>
      ),
    },
    {
      title: t("common.lastModifiedAt"),
      dataIndex: "updatedAt",
      width: 190,
      render: (value: string | null) => formatDate(value, language),
    },
    {
      title: t("common.actions"),
      key: "actions",
      width: 110,
      render: (_, template) => (
        <Button size="small" icon={<Edit3 size={14} />} disabled={!canManage}
          onClick={() => setEditing(template)}>{t("common.edit")}</Button>
      ),
    },
  ], [canManage, language, mailServices, t]);

  const mailColumns = useMemo<TableColumnsType<MailServiceConfig>>(() => [
    {
      title: t("mailServices.name"),
      key: "name",
      render: (_, service) => (
        <Space direction="vertical" size={1}>
          <Space>
            <Typography.Text strong>
              {service.source === "default" ? t("mailServices.default") : service.name}
            </Typography.Text>
            {service.source === "default" && <Tag color="geekblue">{t("mailServices.envDefault")}</Tag>}
          </Space>
          <Typography.Text type="secondary">{service.host}:{service.port}</Typography.Text>
        </Space>
      ),
    },
    { title: t("mailServices.fromAddress"), dataIndex: "fromAddress", ellipsis: true },
    { title: t("mailServices.username"), dataIndex: "username", ellipsis: true },
    {
      title: t("common.status"),
      dataIndex: "enabled",
      width: 110,
      render: (enabled: boolean) => (
        <Tag color={enabled ? "green" : "default"}>
          {t(enabled ? "common.enabled" : "common.disabled")}
        </Tag>
      ),
    },
    {
      title: t("common.actions"),
      key: "actions",
      width: 150,
      render: (_, service) => service.source === "custom" ? (
        <Space size="small">
          <Button size="small" icon={<Edit3 size={14} />} disabled={!canManageMailServices}
            onClick={() => { setEditingMailService(service); setMailModalOpen(true); }} />
          <Popconfirm title={t("mailServices.deleteTitle")}
            description={t("mailServices.deleteDescription")} okButtonProps={{ danger: true }}
            onConfirm={() => onDeleteMailService(service.id!)}>
            <Button danger size="small" icon={<Trash2 size={14} />}
              disabled={!canManageMailServices} />
          </Popconfirm>
        </Space>
      ) : null,
    },
  ], [canManageMailServices, onDeleteMailService, t]);

  return (
    <>
      <h1 className="page-title">{t("emailTemplates.title")}</h1>
      <Typography.Paragraph type="secondary">{t("emailTemplates.description")}</Typography.Paragraph>
      <Tabs items={[
        {
          key: "templates",
          label: t("emailTemplates.templatesTab"),
          children: <>
            <div className="toolbar"><div /><Button icon={<RefreshCw size={15} />}
              onClick={() => void onRefresh()}>{t("common.refresh")}</Button></div>
            <div className="panel">
              <Table rowKey="code" loading={loading} columns={templateColumns} dataSource={templates}
                pagination={false} expandable={{ expandedRowRender: (template) => (
                  <Typography.Paragraph type="secondary" style={{ margin: 0 }}>
                    {template.description}
                  </Typography.Paragraph>
                ) }} scroll={{ x: 920 }} />
            </div>
          </>,
        },
        {
          key: "services",
          label: t("mailServices.tab"),
          children: <>
            <div className="toolbar">
              <Typography.Text type="secondary">{t("mailServices.description")}</Typography.Text>
              <Space>
                <Button icon={<RefreshCw size={15} />} onClick={() => void onRefreshMailServices()}>
                  {t("common.refresh")}
                </Button>
                <Button type="primary" icon={<Plus size={15} />} disabled={!canManageMailServices}
                  onClick={() => { setEditingMailService(null); setMailModalOpen(true); }}>
                  {t("mailServices.create")}
                </Button>
              </Space>
            </div>
            <div className="panel">
              <Table rowKey={(service) => service.id ?? "default"} loading={mailServicesLoading}
                columns={mailColumns} dataSource={mailServices} pagination={false} scroll={{ x: 920 }} />
            </div>
          </>,
        },
      ]} />

      <Modal title={editing ? t("emailTemplates.editTitle", { name: editing.name }) : ""}
        open={Boolean(editing)} width={860} confirmLoading={saving}
        okText={t("emailTemplates.save")} cancelText={t("common.cancel")} destroyOnClose
        onCancel={() => setEditing(null)} onOk={() => form.submit()}>
        <Form form={form} layout="vertical" preserve={false} onFinish={async (values) => {
          if (!editing) return;
          await onSave(editing.code, values.subject, values.body,
            values.mailServiceId === "default" ? null : values.mailServiceId);
          setEditing(null);
        }}>
          <Form.Item name="mailServiceId" label={t("mailServices.sender")} rules={[{ required: true }]}>
            <Select options={serviceOptions} />
          </Form.Item>
          <Form.Item name="subject" label={t("emailTemplates.subject")}
            rules={[{ required: true, whitespace: true }]}>
            <Input maxLength={300} showCount />
          </Form.Item>
          <Form.Item name="body" label={t("emailTemplates.body")}
            rules={[{ required: true, whitespace: true }]}>
            <Input.TextArea rows={11} maxLength={10_000} showCount />
          </Form.Item>
          {editing && <>
            <Typography.Title level={5}>{t("emailTemplates.variables")}</Typography.Title>
            <Typography.Paragraph type="secondary">{t("emailTemplates.variablesHint")}</Typography.Paragraph>
            <Descriptions size="small" bordered column={1}>
              {editing.variables.map((variable) => (
                <Descriptions.Item key={variable.key}
                  label={<Typography.Text copyable={{ text: `{{${variable.key}}}` }} code>
                    {`{{${variable.key}}}`}
                  </Typography.Text>}>
                  {variable.description}
                </Descriptions.Item>
              ))}
            </Descriptions>
            <Typography.Title level={5} style={{ marginTop: 20 }}>{t("emailTemplates.preview")}</Typography.Title>
            <div className="email-template-preview">
              <Typography.Text strong>{renderPreview(subject, editing)}</Typography.Text>
              <Typography.Paragraph style={{ whiteSpace: "pre-wrap", margin: "14px 0 0" }}>
                {renderPreview(body, editing)}
              </Typography.Paragraph>
            </div>
          </>}
        </Form>
      </Modal>

      <Modal title={t(editingMailService ? "mailServices.editTitle" : "mailServices.createTitle")}
        open={mailModalOpen} width={680} confirmLoading={mailServiceSaving}
        okText={t("mailServices.save")} cancelText={t("common.cancel")} destroyOnClose
        onCancel={() => setMailModalOpen(false)} onOk={() => mailForm.submit()}>
        <Form form={mailForm} layout="vertical" preserve={false} onFinish={async (values) => {
          const payload: MailServiceInput = { ...values };
          if (editingMailService && !values.password) delete payload.password;
          await onSaveMailService(editingMailService?.id ?? null, payload);
          setMailModalOpen(false);
        }}>
          <Form.Item name="name" label={t("mailServices.name")}
            rules={[{ required: true, whitespace: true }]}><Input maxLength={100} /></Form.Item>
          <Space size="middle" align="start" style={{ display: "flex" }}>
            <Form.Item name="host" label={t("mailServices.host")}
              rules={[{ required: true, whitespace: true }]} style={{ flex: 1 }}>
              <Input maxLength={255} />
            </Form.Item>
            <Form.Item name="port" label={t("mailServices.port")}
              rules={[{ required: true }]} style={{ width: 130 }}>
              <InputNumber min={1} max={65535} style={{ width: "100%" }} />
            </Form.Item>
            <Form.Item name="secure" label={t("mailServices.secure")} valuePropName="checked">
              <Switch />
            </Form.Item>
          </Space>
          <Form.Item name="username" label={t("mailServices.username")}
            rules={[{ required: true, whitespace: true }]}>
            <Input maxLength={255} autoComplete="off" />
          </Form.Item>
          <Form.Item name="password" label={t("mailServices.password")}
            extra={editingMailService ? t("mailServices.passwordHint") : undefined}
            rules={editingMailService ? [] : [{ required: true, whitespace: true }]}>
            <Input.Password maxLength={1000} autoComplete="new-password" />
          </Form.Item>
          <Form.Item name="fromAddress" label={t("mailServices.fromAddress")}
            extra={t("mailServices.fromAddressHint")} rules={[{ required: true, whitespace: true }]}>
            <Input maxLength={320} placeholder="Codex Switch <noreply@example.com>" />
          </Form.Item>
          <Form.Item name="enabled" label={t("common.enabled")} valuePropName="checked">
            <Switch />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
