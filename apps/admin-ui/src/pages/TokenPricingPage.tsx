import { useEffect, useState } from "react";
import { App, Button, Card, Space, Typography } from "antd";
import { Plus } from "lucide-react";
import {
  isTokenCostPresetDocument, type TokenCostPresetDocument,
} from "../../../../shared/token-cost-presets";
import { useI18n } from "../i18n-context";
import { TokenPricingTable, type PricingRow } from "./TokenPricingTable";

interface Props {
  api: <T>(path: string, options?: RequestInit) => Promise<T>;
  canManage: boolean;
}
const ENDPOINT = "/admin/api/token-cost-presets";
const noticeStyle = { maxWidth: 400, whiteSpace: "normal" as const };

export function TokenPricingPage({ api, canManage }: Props) {
  const { language } = useI18n();
  const zh = language === "zh";
  const { message } = App.useApp();
  const [document, setDocument] = useState<TokenCostPresetDocument | null>(null);
  const [rows, setRows] = useState<PricingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    setLoading(true);
    void api<unknown>(ENDPOINT).then((value) => {
      if (!isTokenCostPresetDocument(value)) throw new Error("Invalid presets");
      if (!active) return;
      setDocument(value);
      setRows(value.models.map((model) => ({ ...model, key: crypto.randomUUID() })));
    }).catch(() => {
      if (active) message.error({ content: zh ? "计价预设加载失败，请重试。" : "Unable to load pricing presets. Please retry.",
        style: noticeStyle });
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [api, attempt, message, zh]);

  const save = async () => {
    if (!document || saving) return;
    const updated = { ...document, models: rows.map(({ key: _key, ...model }) => model) };
    if (!isTokenCostPresetDocument(updated)) {
      message.error({ content: zh ? "请检查名称、别名、价格和倍率，名称及别名不能重复。"
        : "Check names, aliases, prices and multipliers. Names and aliases must be unique.", style: noticeStyle });
      return;
    }
    setSaving(true);
    try {
      const saved = await api<TokenCostPresetDocument>(ENDPOINT, { method: "PATCH", body: JSON.stringify(updated) });
      setDocument(saved);
      message.success({ content: zh ? "已保存，用户下次启动 PC 端时生效。"
        : "Saved. Applies when users next start the PC app.", style: noticeStyle });
    } catch { message.error({ content: zh ? "保存失败，请重试。" : "Unable to save. Please retry.", style: noticeStyle }); }
    finally { setSaving(false); }
  };
  const add = () => setRows((current) => [...current, {
    key: crypto.randomUUID(), model: "", aliases: [], input: 0, cachedInput: 0, output: 0,
    fastModeMultiplier: null, longContextPricing: false, sourceUrl: "",
  }]);

  return <Space direction="vertical" size="large" style={{ width: "100%" }}>
    <div>
      <Typography.Title level={2}>{zh ? "模型计价预设" : "Model pricing presets"}</Typography.Title>
      <Typography.Paragraph type="secondary">{zh
        ? "价格单位为美元 / 每百万 Token。支持添加模型、修改价格和快速模式倍率，用户下次启动 PC 端时自动更新。"
        : "Prices are USD per million tokens. Add models and edit prices or Fast mode multipliers. PCs update on next startup."}
      </Typography.Paragraph>
      <Typography.Text type="secondary">{zh
        ? "用户自定义的价格和倍率优先。开启长上下文计价的模型，默认在输入超过 272,000 Token 时使用长上下文倍率。"
        : "Personal prices and multipliers take precedence. Long-context pricing starts above 272,000 input tokens."}
      </Typography.Text>
      <Typography.Paragraph type="secondary">{zh
        ? "快速模式倍率可单独设置；未公布时留空，按普通价格估算。"
        : "Set Fast mode multipliers per model. Leave unpublished multipliers blank to estimate at standard prices."}
      </Typography.Paragraph>
    </div>
    <Card loading={loading}>
      <TokenPricingTable rows={rows} onChange={setRows} disabled={!canManage || saving || !document} zh={zh} />
      <Space style={{ marginTop: 16 }}>
        {!document && <Button onClick={() => setAttempt((value) => value + 1)}>
          {zh ? "重新加载" : "Reload"}</Button>}
        {canManage && <Button icon={<Plus size={16} />} disabled={!document || saving} onClick={add}>
          {zh ? "添加模型" : "Add model"}</Button>}
        {canManage && <Button type="primary" loading={saving} disabled={!document} onClick={() => void save()}>
          {zh ? "保存预设" : "Save presets"}</Button>}
      </Space>
    </Card>
  </Space>;
}