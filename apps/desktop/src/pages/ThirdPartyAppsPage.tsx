import { Button, Card, Select, Space, Switch, Typography } from "antd";
import { Bot, Play, RefreshCw, SquareTerminal } from "lucide-react";
import type { Translate, TranslationKey } from "../i18n";
import type {
  ClaudeSubagentModel,
  ThirdPartyAppId,
  ThirdPartyAppWriteSettings,
} from "../types";

const THIRD_PARTY_APPS: ReadonlyArray<{
  id: ThirdPartyAppId;
  labelKey: TranslationKey;
}> = [
  { id: "claudeCode", labelKey: "thirdPartyApps.app.claudeCode" },
  { id: "openCode", labelKey: "thirdPartyApps.app.openCode" },
  { id: "openClaw", labelKey: "thirdPartyApps.app.openClaw" },
  { id: "hermesAgent", labelKey: "thirdPartyApps.app.hermesAgent" },
  { id: "trae", labelKey: "thirdPartyApps.app.trae" },
  { id: "workBuddy", labelKey: "thirdPartyApps.app.workBuddy" },
  { id: "zCode", labelKey: "thirdPartyApps.app.zCode" },
  { id: "deepSeekHarness", labelKey: "thirdPartyApps.app.deepSeekHarness" },
  { id: "openViking", labelKey: "thirdPartyApps.app.openViking" },
];

interface ThirdPartyAppsPageProps {
  settings: ThirdPartyAppWriteSettings;
  saving: boolean;
  busy: "launch" | "restart" | null;
  onEnabledChange: (enabled: boolean) => void;
  onWriteCodexChange: (enabled: boolean) => void;
  onAppChange: (appId: ThirdPartyAppId, enabled: boolean) => void;
  onSubagentModelChange: (model: ClaudeSubagentModel) => void;
  onLaunch: () => void;
  onRestart: () => void;
  t: Translate;
}

interface AppRowProps {
  appId: ThirdPartyAppId;
  label: string;
  checked: boolean;
  disabled: boolean;
  busy: ThirdPartyAppsPageProps["busy"];
  onChange: (appId: ThirdPartyAppId, enabled: boolean) => void;
  onLaunch: () => void;
  onRestart: () => void;
  t: Translate;
}

function AppRow(props: AppRowProps) {
  const { appId, label, checked, disabled, busy, onChange, onLaunch, onRestart, t } = props;
  return (
    <div className="third-party-app-row" role="listitem">
      <div className="third-party-app-identity">
        <span className="third-party-app-icon"><SquareTerminal size={18} /></span>
        <Typography.Text strong>{label}</Typography.Text>
      </div>
      <div className="third-party-app-row-actions">
        {appId === "claudeCode" && (
          <Space wrap size={8}>
            <Button size="small" icon={<Play size={14} />} loading={busy === "launch"} onClick={onLaunch}>
              {t("claudeCode.launch")}
            </Button>
            <Button size="small" icon={<RefreshCw size={14} />} loading={busy === "restart"} onClick={onRestart}>
              {t("claudeCode.restart")}
            </Button>
          </Space>
        )}
        <Switch
          checked={checked}
          disabled={disabled}
          aria-label={t("thirdPartyApps.appWriteAria", { app: label })}
          onChange={(enabled) => onChange(appId, enabled)}
        />
      </div>
    </div>
  );
}

export function ThirdPartyAppsPage(props: ThirdPartyAppsPageProps) {
  const {
    settings, saving, busy, onEnabledChange, onWriteCodexChange,
    onAppChange, onSubagentModelChange, onLaunch, onRestart, t,
  } = props;
  return (
    <div className="third-party-apps-page">
      <Card className="third-party-apps-card">
        <div className="third-party-apps-heading">
          <span className="third-party-apps-heading-icon"><Bot size={22} /></span>
          <div>
            <Typography.Title level={3}>{t("thirdPartyApps.title")}</Typography.Title>
            <Typography.Paragraph>{t("thirdPartyApps.description")}</Typography.Paragraph>
          </div>
        </div>
        <div className="third-party-apps-master-settings">
          <div className="third-party-apps-master-item">
            <div>
              <Typography.Text strong>{t("thirdPartyApps.masterWrite")}</Typography.Text>
              <Typography.Paragraph type="secondary">{t("thirdPartyApps.masterWriteHint")}</Typography.Paragraph>
            </div>
            <Switch checked={settings.enabled} loading={saving} onChange={onEnabledChange}
              aria-label={t("thirdPartyApps.masterWrite")} />
          </div>
          <div className="third-party-apps-master-item">
            <div>
              <Typography.Text strong>{t("thirdPartyApps.writeCodex")}</Typography.Text>
              <Typography.Paragraph type="secondary">{t("thirdPartyApps.writeCodexHint")}</Typography.Paragraph>
            </div>
            <Switch checked={settings.writeCodex} disabled={saving} onChange={onWriteCodexChange}
              aria-label={t("thirdPartyApps.writeCodex")} />
          </div>
          <div className="third-party-apps-master-item">
            <div>
              <Typography.Text strong>{t("thirdPartyApps.subagentModel")}</Typography.Text>
              <Typography.Paragraph type="secondary">
                {t("thirdPartyApps.subagentModelHint")}
              </Typography.Paragraph>
            </div>
            <Select<ClaudeSubagentModel>
              value={settings.claudeSubagentModel}
              disabled={saving}
              onChange={onSubagentModelChange}
              options={[
                { value: "sol", label: "GPT-5.6 Sol" },
                { value: "terra", label: "GPT-5.6 Terra" },
                { value: "luna", label: "GPT-5.6 Luna" },
              ]}
              style={{ width: 160 }}
            />
          </div>
        </div>
        <div className="third-party-apps-list-heading">
          <Typography.Text strong>{t("thirdPartyApps.listTitle")}</Typography.Text>
          <Typography.Text type="secondary">{t("thirdPartyApps.listHint")}</Typography.Text>
        </div>
        <div className="third-party-apps-list" role="list">
          {THIRD_PARTY_APPS.map(({ id, labelKey }) => (
            <AppRow key={id} appId={id} label={t(labelKey)} checked={settings.apps[id]}
              disabled={!settings.enabled || saving} busy={busy} onChange={onAppChange}
              onLaunch={onLaunch} onRestart={onRestart} t={t} />
          ))}
        </div>
      </Card>
    </div>
  );
}
