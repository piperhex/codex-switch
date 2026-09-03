import { useEffect, useState } from "react";
import { App, Button, Card, Input, InputNumber, Space, Switch, Table, Typography } from "antd";
import { Plus, Trash2 } from "lucide-react";
import { useI18n } from "../i18n-context";
import type { CodexHomePreset, CodexHomePresetSettings } from "../types";

interface CodexHomePresetsPageProps {
  settings: CodexHomePresetSettings;
  loading: boolean;
  saving: boolean;
  canManage: boolean;
  onRefresh: () => void | Promise<void>;
  onSave: (presets: CodexHomePreset[]) => Promise<void>;
}

function createPreset(): CodexHomePreset {
  return {
    id: globalThis.crypto.randomUUID(),
    name: "",
    windowsPath: "%USERPROFILE%\\.codex",
    macosPath: "~/.codex",
    enabled: true,
    sortOrder: 0,
  };
}

export function CodexHomePresetsPage(props: CodexHomePresetsPageProps) {
  const { message } = App.useApp();
  const { t } = useI18n();
  const [presets, setPresets] = useState(props.settings.presets);

  useEffect(() => setPresets(props.settings.presets), [props.settings]);

  const update = (id: string, changes: Partial<CodexHomePreset>) => {
    setPresets((items) => items.map((item) => item.id === id ? { ...item, ...changes } : item));
  };

  const save = async () => {
    const normalized = presets.map((preset) => ({
      ...preset,
      name: preset.name.trim(),
      windowsPath: preset.windowsPath.trim(),
      macosPath: preset.macosPath.trim(),
    }));
    if (normalized.some((preset) => !preset.name || !preset.windowsPath || !preset.macosPath)) {
      message.error(t("codexHomePresets.invalid"));
      return;
    }
    await props.onSave(normalized);
  };

  return (
    <div className="page-stack">
      <div className="page-heading">
        <div>
          <Typography.Title level={2}>{t("codexHomePresets.title")}</Typography.Title>
          <Typography.Paragraph>{t("codexHomePresets.description")}</Typography.Paragraph>
        </div>
        <Space>
          <Button onClick={() => void props.onRefresh()}>{t("common.refresh")}</Button>
          {props.canManage && (
            <Button type="primary" loading={props.saving} onClick={() => void save()}>
              {t("common.save")}
            </Button>
          )}
        </Space>
      </div>
      <Card
        loading={props.loading}
        title={t("codexHomePresets.listTitle")}
        extra={props.canManage && (
          <Button icon={<Plus size={15} />} onClick={() => setPresets((items) => [...items, createPreset()])}>
            {t("codexHomePresets.add")}
          </Button>
        )}
      >
        <Table<CodexHomePreset>
          rowKey="id"
          dataSource={presets}
          pagination={false}
          locale={{ emptyText: t("codexHomePresets.empty") }}
          scroll={{ x: 900 }}
          columns={[
            {
              title: t("codexHomePresets.enabled"), width: 80,
              render: (_, item) => <Switch checked={item.enabled} disabled={!props.canManage}
                onChange={(enabled) => update(item.id, { enabled })} />,
            },
            {
              title: t("codexHomePresets.name"), width: 180,
              render: (_, item) => <Input value={item.name} disabled={!props.canManage}
                onChange={(event) => update(item.id, { name: event.target.value })} />,
            },
            {
              title: t("codexHomePresets.windowsPath"),
              render: (_, item) => <Input value={item.windowsPath} disabled={!props.canManage}
                onChange={(event) => update(item.id, { windowsPath: event.target.value })} />,
            },
            {
              title: t("codexHomePresets.macosPath"),
              render: (_, item) => <Input value={item.macosPath} disabled={!props.canManage}
                onChange={(event) => update(item.id, { macosPath: event.target.value })} />,
            },
            {
              title: t("codexHomePresets.sortOrder"), width: 100,
              render: (_, item) => <InputNumber min={0} max={10_000} value={item.sortOrder}
                disabled={!props.canManage} onChange={(sortOrder) => update(item.id, { sortOrder: sortOrder ?? 0 })} />,
            },
            {
              title: t("common.actions"), width: 70,
              render: (_, item) => props.canManage && <Button danger type="text" icon={<Trash2 size={15} />}
                aria-label={t("common.delete")}
                onClick={() => setPresets((items) => items.filter((preset) => preset.id !== item.id))} />,
            },
          ]}
        />
      </Card>
    </div>
  );
}
