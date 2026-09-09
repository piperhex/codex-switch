import { ColorPicker, Form, Space, Typography } from "antd";
import { BellRing } from "lucide-react";
import { useI18n } from "../i18n-context";
import type { AnnouncementConfig } from "../types";

type AnnouncementColors = Pick<
  AnnouncementConfig, "textColor" | "backgroundColor" | "darkTextColor" | "darkBackgroundColor"
>;

interface AnnouncementAppearanceProps {
  colors: AnnouncementColors;
  preview: string;
  scrollDurationSeconds: number;
  disabled: boolean;
  onChange: (colors: Partial<AnnouncementColors>) => void;
  onSave: () => void;
}

const palettes = [
  { mode: "light", text: "textColor", background: "backgroundColor" },
  { mode: "dark", text: "darkTextColor", background: "darkBackgroundColor" },
] as const;

export function AnnouncementAppearance(props: AnnouncementAppearanceProps) {
  const { t } = useI18n();
  return (
    <>
      <div className="announcement-palettes">
        {palettes.map((palette) => (
          <div className="announcement-palette" key={palette.mode}>
            <Typography.Title level={5}>{t(`announcement.${palette.mode}Mode`)}</Typography.Title>
            <Space size="large" wrap>
              {([palette.text, palette.background] as const).map((field, index) => (
                <Form.Item key={field} label={t(index === 0
                  ? "announcement.textColor" : "announcement.backgroundColor")}>
                  <ColorPicker
                    value={props.colors[field]}
                    showText
                    disabledAlpha
                    onChange={(color) => props.onChange({ [field]: color.toHexString().toUpperCase() })}
                    onOpenChange={(open) => { if (!open) props.onSave(); }}
                    disabled={props.disabled}
                  />
                </Form.Item>
              ))}
            </Space>
            <Form.Item label={t("announcement.preview")}>
              <div className="announcement-preview" style={{
                color: props.colors[palette.text],
                backgroundColor: props.colors[palette.background],
              }}>
                <div className="announcement-preview-track" key={props.preview}
                  style={{ animationDuration: `${props.scrollDurationSeconds}s` }}>
                  <BellRing size={15} />
                  <span>{props.preview}</span>
                </div>
              </div>
            </Form.Item>
          </div>
        ))}
      </div>
      <Typography.Paragraph type="secondary">{t("announcement.previewLanguageHint")}</Typography.Paragraph>
    </>
  );
}
