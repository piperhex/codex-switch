import { useEffect, useState } from "react";
import { Button, ColorPicker, Form, Input, InputNumber, Space, Switch, Typography } from "antd";
import { BellRing, RefreshCw, Save } from "lucide-react";
import { useI18n } from "../i18n-context";
import type { AnnouncementConfig } from "../types";
import { formatDate } from "../utils/format";

interface AnnouncementPageProps {
  announcement: AnnouncementConfig;
  loading: boolean;
  saving: boolean;
  onRefresh: () => void | Promise<void>;
  onSave: (announcement: Pick<
    AnnouncementConfig,
    "contentZh" | "contentEn" | "link" | "enabled" | "textColor"
    | "backgroundColor" | "scrollDurationSeconds"
  >) => Promise<void>;
  canManage: boolean;
}

export function AnnouncementPage({
  announcement,
  loading,
  saving,
  onRefresh,
  onSave,
  canManage,
}: AnnouncementPageProps) {
  const { language, t } = useI18n();
  const [contentZh, setContentZh] = useState(announcement.contentZh);
  const [contentEn, setContentEn] = useState(announcement.contentEn);
  const [link, setLink] = useState(announcement.link);
  const [enabled, setEnabled] = useState(announcement.enabled);
  const [textColor, setTextColor] = useState(announcement.textColor);
  const [backgroundColor, setBackgroundColor] = useState(announcement.backgroundColor);
  const [scrollDurationSeconds, setScrollDurationSeconds] = useState(
    announcement.scrollDurationSeconds,
  );

  useEffect(() => {
    setContentZh(announcement.contentZh);
    setContentEn(announcement.contentEn);
    setLink(announcement.link);
    setEnabled(announcement.enabled);
    setTextColor(announcement.textColor);
    setBackgroundColor(announcement.backgroundColor);
    setScrollDurationSeconds(announcement.scrollDurationSeconds);
  }, [announcement]);

  const previewContent = language === "zh" ? contentZh : contentEn;
  const preview = previewContent.trim() || t("announcement.emptyPreview");
  const normalizedLink = link.trim();
  let linkIsValid = true;
  if (normalizedLink) {
    try {
      const url = new URL(normalizedLink);
      linkIsValid = url.protocol === "http:" || url.protocol === "https:";
    } catch {
      linkIsValid = false;
    }
  }

  return (
    <>
      <h1 className="page-title">{t("announcement.title")}</h1>
      <Typography.Paragraph type="secondary">{t("announcement.description")}</Typography.Paragraph>
      <div className="toolbar">
        <div className="toolbar-left">
          {announcement.updatedAt && (
            <Typography.Text type="secondary">
              {t("announcement.updatedAt", { time: formatDate(announcement.updatedAt, language) })}
            </Typography.Text>
          )}
        </div>
        <div className="toolbar-right">
          <Button loading={loading} icon={<RefreshCw size={15} />} onClick={() => void onRefresh()}>
            {t("common.refresh")}
          </Button>
        </div>
      </div>
      <div className="panel announcement-config-panel">
        <Form layout="vertical" onFinish={() => void onSave({
          contentZh: contentZh.trim(),
          contentEn: contentEn.trim(),
          link: normalizedLink,
          enabled,
          textColor,
          backgroundColor,
          scrollDurationSeconds,
        })}>
          <Form.Item label={t("announcement.enabled")} extra={t("announcement.enabledHint")}>
            <Switch disabled={!canManage} checked={enabled} onChange={setEnabled} />
          </Form.Item>
          <Form.Item label={t("announcement.contentZh")}>
            <Input.TextArea
              value={contentZh}
              rows={5}
              maxLength={1000}
              showCount
              placeholder={t("announcement.contentZhPlaceholder")}
              onChange={(event) => setContentZh(event.target.value)}
              disabled={!canManage}
            />
          </Form.Item>
          <Form.Item label={t("announcement.contentEn")}>
            <Input.TextArea
              value={contentEn}
              rows={5}
              maxLength={1000}
              showCount
              placeholder={t("announcement.contentEnPlaceholder")}
              onChange={(event) => setContentEn(event.target.value)}
              disabled={!canManage}
            />
          </Form.Item>
          <Form.Item
            label={t("announcement.link")}
            extra={linkIsValid ? t("announcement.linkHint") : undefined}
            validateStatus={linkIsValid ? undefined : "error"}
            help={linkIsValid ? undefined : t("announcement.linkInvalid")}
          >
            <Input
              value={link}
              maxLength={2048}
              placeholder={t("announcement.linkPlaceholder")}
              onChange={(event) => setLink(event.target.value)}
              disabled={!canManage}
              allowClear
            />
          </Form.Item>
          <Space size="large" wrap>
            <Form.Item label={t("announcement.textColor")}>
              <ColorPicker
                value={textColor}
                showText
                onChange={(color) => setTextColor(color.toHexString().toUpperCase())}
                disabled={!canManage}
              />
            </Form.Item>
            <Form.Item label={t("announcement.backgroundColor")}>
              <ColorPicker
                value={backgroundColor}
                showText
                onChange={(color) => setBackgroundColor(color.toHexString().toUpperCase())}
                disabled={!canManage}
              />
            </Form.Item>
            <Form.Item
              label={t("announcement.scrollSpeed")}
              extra={t("announcement.scrollSpeedHint")}
            >
              <InputNumber
                min={5}
                max={120}
                precision={0}
                value={scrollDurationSeconds}
                addonAfter={t("announcement.secondsPerLoop")}
                onChange={(value) => setScrollDurationSeconds(value ?? 22)}
                disabled={!canManage}
              />
            </Form.Item>
          </Space>
          <Form.Item
            label={t("announcement.preview")}
            extra={t("announcement.previewLanguageHint")}
          >
            <div className="announcement-preview" style={{ color: textColor, backgroundColor }}>
              <div
                className="announcement-preview-track"
                key={preview}
                style={{ animationDuration: `${scrollDurationSeconds}s` }}
              >
                <BellRing size={15} />
                <span>{preview}</span>
              </div>
            </div>
          </Form.Item>
          <Space>
            <Button
              type="primary"
              htmlType="submit"
              loading={saving}
              disabled={!canManage || !linkIsValid
                || (enabled && (!contentZh.trim() || !contentEn.trim()))}
              icon={<Save size={15} />}
            >
              {t("announcement.save")}
            </Button>
          </Space>
        </Form>
      </div>
    </>
  );
}
