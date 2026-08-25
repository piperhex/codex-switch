import { useEffect, useState } from "react";
import { App, Button, Card, Form, Input, Space, Table, Typography } from "antd";
import { Plus, Trash2 } from "lucide-react";
import { useI18n } from "../i18n-context";
import type { CurrencyItem, CurrencySettings } from "../types";

interface CurrencyPageProps {
  settings: CurrencySettings;
  loading: boolean;
  saving: boolean;
  canManage: boolean;
  onRefresh: () => void | Promise<void>;
  onSave: (apiKey: string, currencies: CurrencyItem[], clearApiKey: boolean) => Promise<void>;
}

const emptyItem: CurrencyItem = { code: "", name: "" };

export function CurrencyPage({ settings, loading, saving, canManage, onRefresh, onSave }: CurrencyPageProps) {
  const { message } = App.useApp();
  const { t } = useI18n();
  const [apiKey, setApiKey] = useState("");
  const [clearApiKey, setClearApiKey] = useState(false);
  const [currencies, setCurrencies] = useState<CurrencyItem[]>(settings.currencies);

  useEffect(() => {
    setCurrencies(settings.currencies);
    setApiKey("");
    setClearApiKey(false);
  }, [settings]);

  const updateItem = (index: number, field: keyof CurrencyItem, value: string) => {
    setCurrencies((items) => items.map((item, itemIndex) => (
      itemIndex === index ? { ...item, [field]: value } : item
    )));
  };

  const save = async () => {
    const normalized = currencies.map((item) => ({ code: item.code.trim().toUpperCase(), name: item.name.trim() }));
    if (normalized.some((item) => !/^[A-Z]{3}$/.test(item.code) || !item.name)) {
      message.error(t("currency.invalid"));
      return;
    }
    if (new Set(normalized.map((item) => item.code)).size !== normalized.length) {
      message.error(t("currency.duplicate"));
      return;
    }
    await onSave(apiKey.trim(), normalized, clearApiKey);
    setApiKey("");
    setClearApiKey(false);
  };

  return (
    <div className="page-stack">
      <div className="page-heading">
        <div>
          <Typography.Title level={2}>{t("currency.title")}</Typography.Title>
          <Typography.Paragraph>{t("currency.description")}</Typography.Paragraph>
        </div>
        <Space>
          <Button onClick={() => void onRefresh()}>{t("common.refresh")}</Button>
          {canManage && <Button type="primary" loading={saving} onClick={() => void save()}>{t("common.save")}</Button>}
        </Space>
      </div>
      <Card loading={loading} title={t("currency.apiKeyTitle")}>
        <Form layout="vertical">
          <Form.Item
            label={t("currency.apiKey")}
            extra={settings.hasApiKey ? t("currency.apiKeyConfigured") : t("currency.apiKeyMissing")}
          >
            <Input.Password
              value={apiKey}
              disabled={!canManage}
              placeholder={settings.hasApiKey
                ? t("currency.apiKeyPlaceholderExisting")
                : t("currency.apiKeyPlaceholder")}
              onChange={(event) => { setApiKey(event.target.value); setClearApiKey(false); }}
            />
          </Form.Item>
          {settings.hasApiKey && canManage && (
            <Button type="link" danger onClick={() => { setApiKey(""); setClearApiKey(true); }}>
              {t("currency.clearApiKey")}
            </Button>
          )}
        </Form>
      </Card>
      <Card
        title={t("currency.currenciesTitle")}
        extra={canManage && (
          <Button
            icon={<Plus size={15} />}
            onClick={() => setCurrencies((items) => [...items, { ...emptyItem }])}
          >
            {t("currency.add")}
          </Button>
        )}
      >
        <Table<CurrencyItem>
          rowKey={(_, index) => `${index}`}
          dataSource={currencies}
          pagination={false}
          locale={{ emptyText: t("currency.empty") }}
          columns={[
            {
              title: t("currency.code"),
              render: (_, item, index) => (
                <Input
                  value={item.code}
                  maxLength={3}
                  disabled={!canManage}
                  onChange={(event) => updateItem(index, "code", event.target.value)}
                />
              ),
            },
            {
              title: t("currency.name"),
              render: (_, item, index) => (
                <Input
                  value={item.name}
                  maxLength={40}
                  disabled={!canManage}
                  onChange={(event) => updateItem(index, "name", event.target.value)}
                />
              ),
            },
            {
              title: t("common.actions"),
              width: 100,
              render: (_, _item, index) => canManage && (
                <Button
                  danger
                  type="text"
                  icon={<Trash2 size={15} />}
                  aria-label={t("common.delete")}
                  onClick={() => setCurrencies((items) => (
                    items.filter((_, itemIndex) => itemIndex !== index)
                  ))}
                />
              ),
            },
          ]}
        />
      </Card>
    </div>
  );
}
