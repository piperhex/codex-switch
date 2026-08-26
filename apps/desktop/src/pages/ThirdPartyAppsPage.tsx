import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Button, Card, Popconfirm, Select, Space, Switch, Typography } from "antd";
import { Play, RefreshCw, SquareTerminal } from "lucide-react";
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
  { id: "workBuddy", labelKey: "thirdPartyApps.app.workBuddy" },
  { id: "zCode", labelKey: "thirdPartyApps.app.zCode" },
  { id: "deepSeekHarness", labelKey: "thirdPartyApps.app.deepSeekHarness" },
  { id: "openViking", labelKey: "thirdPartyApps.app.openViking" },
];

interface ThirdPartyAppsPageProps {
  settings: ThirdPartyAppWriteSettings;
  saving: boolean;
  proxyBusy: boolean;
  proxyRunning: boolean;
  proxyStartDisabledReason?: string;
  hasProxyTarget: boolean;
  busy: "launch" | "restart" | null;
  onEnabledChange: (enabled: boolean) => void;
  onWriteCodexChange: (enabled: boolean) => void;
  onStartProxy: () => void;
  onOpenAccounts: () => void;
  onOpenProviders: () => void;
  onAppChange: (appId: ThirdPartyAppId, enabled: boolean) => void;
  onSubagentModelChange: (model: ClaudeSubagentModel) => void;
  onLaunch: (appId: LaunchableThirdPartyApp) => void;
  onRestart: (appId: LaunchableThirdPartyApp) => void;
  t: Translate;
}

type LaunchableThirdPartyApp = "claudeCode" | "openCode";

function isLaunchableThirdPartyApp(appId: ThirdPartyAppId): appId is LaunchableThirdPartyApp {
  return appId === "claudeCode" || appId === "openCode";
}

interface AppRowProps {
  appId: ThirdPartyAppId;
  label: string;
  checked: boolean;
  disabled: boolean;
  busy: ThirdPartyAppsPageProps["busy"];
  subagentModel: ClaudeSubagentModel;
  onChange: (appId: ThirdPartyAppId, enabled: boolean) => void;
  onSubagentModelChange: (model: ClaudeSubagentModel) => void;
  onLaunch: (appId: LaunchableThirdPartyApp) => void;
  onRestart: (appId: LaunchableThirdPartyApp) => void;
  t: Translate;
}

function AppRow(props: AppRowProps) {
  const {
    appId, label, checked, disabled, busy, subagentModel,
    onChange, onSubagentModelChange, onLaunch, onRestart, t,
  } = props;
  const hasProcessControls = isLaunchableThirdPartyApp(appId);
  const launchLabel = appId === "claudeCode" ? t("claudeCode.launch") : t("openCode.launch");
  const restartLabel = appId === "claudeCode" ? t("claudeCode.restart") : t("openCode.restart");
  return (
    <div className="third-party-app-row" role="listitem">
      <div className="third-party-app-identity">
        <span className="third-party-app-icon"><SquareTerminal size={18} /></span>
        <Typography.Text strong>{label}</Typography.Text>
      </div>
      <div className="third-party-app-row-actions">
        {hasProcessControls && (
          <Space wrap size={8}>
            <Typography.Text type="secondary">{t("thirdPartyApps.subagentModel")}</Typography.Text>
            <Select<ClaudeSubagentModel>
              value={subagentModel}
              disabled={disabled}
              onChange={onSubagentModelChange}
              options={[
                { value: "sol", label: "GPT-5.6 Sol" },
                { value: "terra", label: "GPT-5.6 Terra" },
                { value: "luna", label: "GPT-5.6 Luna" },
              ]}
              style={{ width: 150 }}
            />
            <Button size="small" icon={<Play size={14} />} loading={busy === "launch"}
              onClick={() => onLaunch(appId)}>
              {launchLabel}
            </Button>
            <Button size="small" icon={<RefreshCw size={14} />} loading={busy === "restart"}
              onClick={() => onRestart(appId)}>
              {restartLabel}
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
    settings, saving, proxyBusy, proxyRunning, proxyStartDisabledReason, hasProxyTarget, busy,
    onEnabledChange, onWriteCodexChange, onStartProxy, onOpenAccounts, onOpenProviders,
    onAppChange, onSubagentModelChange, onLaunch, onRestart, t,
  } = props;
  const [topbarHost, setTopbarHost] = useState<HTMLElement | null>(null);

  useEffect(() => {
    setTopbarHost(document.getElementById("third-party-apps-topbar-actions"));
  }, []);

  return (
    <>
      {topbarHost && createPortal(
        <div className="third-party-apps-topbar-controls">
          {!proxyRunning && (
            <div className="third-party-apps-proxy-warning">
              <Typography.Text type="warning">{t("thirdPartyApps.proxyRequired")}</Typography.Text>
              <Popconfirm title={t("providers.proxy.startConfirmTitle")}
                description={<span className="proxy-start-confirm-description">{t("providers.proxy.description")}</span>}
                okText={t("providers.proxy.start")} cancelText={t("providers.proxy.cancel")}
                disabled={proxyBusy || Boolean(proxyStartDisabledReason)} onConfirm={onStartProxy}>
                <Button type="link" size="small" loading={proxyBusy}
                  disabled={proxyBusy || Boolean(proxyStartDisabledReason)}>
                  {t("thirdPartyApps.openProxy")}
                </Button>
              </Popconfirm>
            </div>
          )}
          {proxyRunning && !hasProxyTarget && (
            <div className="third-party-apps-proxy-warning">
              <Typography.Text type="warning">{t("thirdPartyApps.targetRequired")}</Typography.Text>
              <Button type="link" size="small" onClick={onOpenAccounts}>
                {t("thirdPartyApps.openAccounts")}
              </Button>
              <Button type="link" size="small" onClick={onOpenProviders}>
                {t("thirdPartyApps.openProviders")}
              </Button>
            </div>
          )}
          <label className="third-party-apps-topbar-control">
            <Typography.Text strong>{t("thirdPartyApps.masterWrite")}</Typography.Text>
            <Switch checked={settings.enabled} loading={saving}
              disabled={!proxyRunning || !hasProxyTarget} onChange={onEnabledChange}
              aria-label={t("thirdPartyApps.masterWrite")} />
          </label>
          <label className="third-party-apps-topbar-control">
            <Typography.Text strong>{t("thirdPartyApps.writeCodex")}</Typography.Text>
            <Switch checked={settings.writeCodex} disabled={saving} onChange={onWriteCodexChange}
              aria-label={t("thirdPartyApps.writeCodex")} />
          </label>
        </div>,
        topbarHost,
      )}
      <div className="third-party-apps-page">
        <Card className="third-party-apps-card">
          <div className="third-party-apps-list-heading">
            <Typography.Text strong>{t("thirdPartyApps.listTitle")}</Typography.Text>
            <Typography.Text type="secondary">{t("thirdPartyApps.listHint")}</Typography.Text>
          </div>
          <div className="third-party-apps-list" role="list">
            {THIRD_PARTY_APPS.map(({ id, labelKey }) => (
              <AppRow key={id} appId={id} label={t(labelKey)} checked={settings.apps[id]}
                disabled={!settings.enabled || saving} busy={busy}
                subagentModel={settings.claudeSubagentModel} onChange={onAppChange}
                onSubagentModelChange={onSubagentModelChange}
                onLaunch={onLaunch} onRestart={onRestart} t={t} />
            ))}
          </div>
        </Card>
      </div>
    </>
  );
}
