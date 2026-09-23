import { useState } from "react";
import { Alert, App, InputNumber, Modal, Select, Space, Typography } from "antd";
import type { TrafficApi, UserChatTraffic } from "../chat-traffic-types";
import { useI18n } from "../i18n-context";

const UNITS = [{ value: 1, label: "B" }, { value: 1024 ** 2, label: "MB" }, { value: 1024 ** 3, label: "GB" }];

export function ChatTrafficLimitModal({ user, api, onClose, onSaved }: {
  user: UserChatTraffic; api: TrafficApi; onClose: () => void; onSaved: () => void;
}) {
  const { language } = useI18n();
  const zh = language === "zh";
  const { message } = App.useApp();
  const [value, setValue] = useState<number | null>(user.monthlyLimitBytes);
  const [unit, setUnit] = useState(1);
  const [saving, setSaving] = useState(false);
  const bytes = value === -1 ? -1 : value === null ? NaN : value * unit;
  const valid = Number.isSafeInteger(bytes) && bytes >= -1 && (value === -1 || Number(value) >= 0);
  const save = async () => {
    if (!valid || saving) return;
    setSaving(true);
    try {
      await api(`/admin/api/chat-traffic/users/${user.id}/limit`, {
        method: "PATCH", body: JSON.stringify({ monthlyLimitBytes: bytes }),
      });
      message.success({ content: zh ? "每月转发额度已更新。" : "Monthly relay allowance updated.",
        style: { maxWidth: 400 } });
      onSaved();
      onClose();
    } catch {
      message.error({ content: zh ? "保存失败，请重试。" : "Unable to save. Please retry.", style: { maxWidth: 400 } });
    } finally { setSaving(false); }
  };
  return <Modal open title={zh ? "设置每月转发额度" : "Monthly relay allowance"} width={400}
    onCancel={onClose} onOk={() => void save()} confirmLoading={saving} okButtonProps={{ disabled: !valid }}
    cancelButtonProps={{ disabled: saving }} closable={!saving} maskClosable={!saving} keyboard={!saving}>
    <Space direction="vertical" size="middle" style={{ width: "100%" }}>
      <Typography.Text style={{ overflowWrap: "anywhere" }}>{user.email}</Typography.Text>
      <Space.Compact style={{ width: "100%" }}>
        <InputNumber aria-label={zh ? "每月转发额度" : "Monthly relay allowance"} value={value} min={-1}
          onChange={setValue} style={{ width: "100%" }} disabled={saving} />
        <Select aria-label={zh ? "流量单位" : "Traffic unit"} value={unit} options={UNITS}
          onChange={setUnit} style={{ width: 90 }} disabled={saving} />
      </Space.Compact>
      <Typography.Text type="secondary">{zh ? "-1 表示不限量，0 表示禁用转发。1 GB = 1024 MB。"
        : "-1 means unlimited; 0 disables relay. 1 GB = 1024 MB."}</Typography.Text>
      <Alert type="info" showIcon message={zh ? "每月 1 日按北京时间重置额度。达到上限后仍可使用 P2P 直连。"
        : "Resets on the first of each month (UTC+8). P2P remains available after the relay limit is reached."} />
    </Space>
  </Modal>;
}
