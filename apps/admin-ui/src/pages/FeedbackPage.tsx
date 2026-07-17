import { useEffect, useState } from "react";
import {
  Button,
  Descriptions,
  Form,
  Image,
  Input,
  Modal,
  Space,
  Table,
  Tag,
  Tooltip,
  Typography,
} from "antd";
import type { TableColumnsType } from "antd";
import { Eye, Mail, RefreshCw } from "lucide-react";
import { useI18n } from "../i18n-context";
import type { FeedbackRow, PageResult } from "../types";
import { formatDate } from "../utils/format";

interface FeedbackPageProps {
  feedback: PageResult<FeedbackRow>;
  loading: boolean;
  onLoad: (page?: number, pageSize?: number) => void | Promise<void>;
  onLoadAttachment: (feedbackId: string, attachmentId: string) => Promise<string>;
  onSendEmail: (feedbackId: string, subject: string, content: string) => Promise<void>;
}

interface EmailForm {
  subject: string;
  content: string;
}

function formatBytes(bytes: number) {
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

export function FeedbackPage({
  feedback,
  loading,
  onLoad,
  onLoadAttachment,
  onSendEmail,
}: FeedbackPageProps) {
  const { language, t } = useI18n();
  const [selected, setSelected] = useState<FeedbackRow | null>(null);
  const [emailing, setEmailing] = useState<FeedbackRow | null>(null);
  const [imageUrls, setImageUrls] = useState<Record<string, string>>({});
  const [imagesLoading, setImagesLoading] = useState(false);
  const [emailSending, setEmailSending] = useState(false);
  const [form] = Form.useForm<EmailForm>();

  useEffect(() => {
    let cancelled = false;
    const urls: string[] = [];
    setImageUrls({});
    if (!selected?.attachments.length) return undefined;
    setImagesLoading(true);
    void Promise.all(selected.attachments.map(async (attachment) => {
      const url = await onLoadAttachment(selected.id, attachment.id);
      urls.push(url);
      return [attachment.id, url] as const;
    })).then((entries) => {
      if (!cancelled) setImageUrls(Object.fromEntries(entries));
    }).catch(() => {
      urls.forEach(URL.revokeObjectURL);
      urls.length = 0;
      if (!cancelled) setImageUrls({});
    }).finally(() => {
      if (!cancelled) setImagesLoading(false);
    });
    return () => {
      cancelled = true;
      urls.forEach(URL.revokeObjectURL);
    };
  }, [onLoadAttachment, selected]);

  const openEmail = (row: FeedbackRow) => {
    setEmailing(row);
    form.setFieldsValue({
      subject: t("feedback.emailDefaultSubject"),
      content: "",
    });
  };

  const columns: TableColumnsType<FeedbackRow> = [
    {
      title: t("feedback.time"),
      dataIndex: "createdAt",
      width: 178,
      render: (value: string) => formatDate(value, language),
    },
    {
      title: t("feedback.content"),
      dataIndex: "content",
      render: (value: string) => (
        <Typography.Text ellipsis={{ tooltip: value }} style={{ display: "block", maxWidth: 420 }}>
          {value}
        </Typography.Text>
      ),
    },
    {
      title: t("feedback.version"),
      dataIndex: "version",
      width: 100,
      render: (value: string) => <Tag>v{value}</Tag>,
    },
    {
      title: t("feedback.email"),
      dataIndex: "email",
      width: 220,
      render: (value: string | null) => value || <Typography.Text type="secondary">{t("feedback.anonymous")}</Typography.Text>,
    },
    {
      title: t("feedback.attachments"),
      dataIndex: "attachments",
      width: 90,
      align: "center",
      render: (value: FeedbackRow["attachments"]) => value.length,
    },
    {
      title: t("feedback.replyStatus"),
      dataIndex: "lastRepliedAt",
      width: 110,
      render: (value: string | null) => value
        ? <Tag color="green">{t("feedback.replied")}</Tag>
        : <Tag>{t("feedback.notReplied")}</Tag>,
    },
    {
      title: t("common.actions"),
      key: "actions",
      width: 190,
      fixed: "right",
      render: (_, row) => (
        <Space>
          <Button size="small" icon={<Eye size={14} />} onClick={() => setSelected(row)}>
            {t("feedback.view")}
          </Button>
          <Tooltip title={row.email ? undefined : t("feedback.noEmailHint")}>
            <span>
              <Button size="small" icon={<Mail size={14} />} disabled={!row.email}
                onClick={() => openEmail(row)}>{t("feedback.sendEmail")}</Button>
            </span>
          </Tooltip>
        </Space>
      ),
    },
  ];

  return (
    <>
      <h1 className="page-title">{t("feedback.title")}</h1>
      <div className="toolbar">
        <div className="toolbar-left">
          <Typography.Text type="secondary">{t("feedback.total", { count: feedback.total })}</Typography.Text>
        </div>
        <Button icon={<RefreshCw size={15} />} onClick={() => onLoad()}>{t("common.refresh")}</Button>
      </div>
      <div className="panel">
        <Table rowKey="id" loading={loading} columns={columns} dataSource={feedback.items}
          pagination={{
            current: feedback.page,
            pageSize: feedback.pageSize,
            total: feedback.total,
            showSizeChanger: true,
          }}
          onChange={(pagination) => onLoad(pagination.current, pagination.pageSize)}
          scroll={{ x: 1280 }} />
      </div>

      <Modal title={t("feedback.detailTitle")} open={Boolean(selected)} width={760} footer={null}
        onCancel={() => setSelected(null)} destroyOnClose>
        {selected && (
          <div className="feedback-detail">
            <Descriptions size="small" bordered column={2}>
              <Descriptions.Item label={t("feedback.time")}>
                {formatDate(selected.createdAt, language)}
              </Descriptions.Item>
              <Descriptions.Item label={t("feedback.email")}>
                {selected.email || t("feedback.anonymous")}
              </Descriptions.Item>
              <Descriptions.Item label={t("feedback.version")}>v{selected.version}</Descriptions.Item>
              <Descriptions.Item label={t("feedback.platform")}>{selected.platform}</Descriptions.Item>
              {selected.lastRepliedAt && (
                <Descriptions.Item label={t("feedback.lastReply")} span={2}>
                  {formatDate(selected.lastRepliedAt, language)} · {selected.lastRepliedByEmail}
                </Descriptions.Item>
              )}
            </Descriptions>
            <Typography.Title level={5}>{t("feedback.content")}</Typography.Title>
            <div className="feedback-detail-content">{selected.content}</div>
            {selected.attachments.length > 0 && (
              <>
                <Typography.Title level={5}>{t("feedback.attachments")}</Typography.Title>
                <Image.PreviewGroup>
                  <div className="feedback-detail-images">
                    {selected.attachments.map((attachment) => (
                      <div key={attachment.id}>
                        {imageUrls[attachment.id]
                          ? <Image src={imageUrls[attachment.id]} alt={attachment.fileName} />
                          : <div className="feedback-image-placeholder">{imagesLoading ? t("feedback.loadingImage") : "-"}</div>}
                        <Typography.Text ellipsis title={attachment.fileName}>{attachment.fileName}</Typography.Text>
                        <Typography.Text type="secondary">{formatBytes(attachment.size)}</Typography.Text>
                      </div>
                    ))}
                  </div>
                </Image.PreviewGroup>
              </>
            )}
            {selected.email && (
              <Button type="primary" icon={<Mail size={15} />} onClick={() => openEmail(selected)}>
                {t("feedback.sendEmail")}
              </Button>
            )}
          </div>
        )}
      </Modal>

      <Modal title={t("feedback.emailTitle")} open={Boolean(emailing)} confirmLoading={emailSending}
        okText={t("feedback.send")} cancelText={t("common.cancel")}
        onCancel={() => setEmailing(null)} onOk={() => form.submit()} destroyOnClose>
        <Form form={form} layout="vertical" onFinish={async (values) => {
          if (!emailing) return;
          setEmailSending(true);
          try {
            await onSendEmail(emailing.id, values.subject, values.content);
            setEmailing(null);
          } catch {
            // The parent reports the API error and the form remains open for retry.
          } finally {
            setEmailSending(false);
          }
        }}>
          <Typography.Paragraph type="secondary">
            {t("feedback.emailTo", { email: emailing?.email ?? "" })}
          </Typography.Paragraph>
          <Form.Item name="subject" label={t("feedback.emailSubject")}
            rules={[{ required: true, whitespace: true }]}>
            <Input maxLength={200} showCount />
          </Form.Item>
          <Form.Item name="content" label={t("feedback.emailContent")}
            rules={[{ required: true, whitespace: true }]}>
            <Input.TextArea rows={7} maxLength={5000} showCount />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
