import { useEffect, useState } from "react";
import { App, Button, Card, Form, Input, Space, Table, Typography } from "antd";
import { Plus, Trash2 } from "lucide-react";
import { useI18n } from "../i18n-context";
import { formatDate } from "../utils/format";
import type { CurrencyItem, CurrencyRate, CurrencySettings } from "../types";

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
  const { language, t } = useI18n();
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
    try {
      await onSave(apiKey.trim(), normalized, clearApiKey);
      setApiKey("");
      setClearApiKey(false);
    } catch {
      // The parent displays the request error and keeps the entered value for retry.
    }
  };

  const saveApiKeyOnBlur = async () => {
    const value = apiKey.trim();
    if (!canManage || !value || clearApiKey) return;
    try {
      await onSave(value, settings.currencies, false);
      setApiKey("");
    } catch {
      // The parent displays the request error and keeps the entered value for retry.
    }
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
        </Space>
      </div>
      <Card loading={loading} title={t("currency.apiKeyTitle")}>
        <Form layout="vertical">
          <Form.Item
            label={t("currency.apiKey")}
            extra={settings.hasApiKey ? t("currency.apiKeyConfigured") : t("currency.apiKeyMissing")}
          >
            <Space.Compact block>
              <Input.Password
                value={apiKey}
                disabled={!canManage}
                placeholder={settings.hasApiKey
                  ? t("currency.apiKeyPlaceholderExisting")
                  : t("currency.apiKeyPlaceholder")}
                onChange={(event) => { setApiKey(event.target.value); setClearApiKey(false); }}
                onBlur={() => void saveApiKeyOnBlur()}
              />
              {settings.hasApiKey && canManage && (
                <Button danger onClick={() => { setApiKey(""); setClearApiKey(true); }}>
                  {t("currency.clearApiKey")}
                </Button>
              )}
            </Space.Compact>
          </Form.Item>
        </Form>
      </Card>
      <Card
        title={t("currency.currenciesTitle")}
        extra={canManage && (
          <Space>
            <Button loading={saving} type="primary" onClick={() => void save()}>{t("common.save")}</Button>
            <Button
              icon={<Plus size={15} />}
              onClick={() => setCurrencies((items) => [...items, { ...emptyItem }])}
            >
              {t("currency.add")}
            </Button>
          </Space>
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
      <Card
        loading={loading}
        title={t("currency.cacheTitle")}
        extra={settings.cacheExpiresAt
          ? t("currency.cacheExpiresAt", { time: formatDate(settings.cacheExpiresAt, language) })
          : undefined}
      >
        <Table<CurrencyRate>
          rowKey="code"
          dataSource={settings.cachedRates}
          pagination={false}
          locale={{ emptyText: t("currency.cacheEmpty") }}
          columns={[
            { title: t("currency.name"), dataIndex: "name" },
            { title: t("currency.code"), dataIndex: "code", width: 120 },
            {
              title: t("currency.rate"),
              dataIndex: "rate",
              width: 160,
              render: (value: number) => value.toLocaleString(undefined, { maximumFractionDigits: 8 }),
            },
          ]}
        />
      </Card>
    </div>
  );
}
