import { useEffect, useRef, useState } from "react";
import { Button, Input, InputNumber, Space } from "antd";
import { Cloud, Network } from "lucide-react";
import { DEFAULT_CLOUD_BASE_URL } from "../../api/backend";
import type { SettingsPageProps } from "./types";

interface ConnectionSettingsCardsProps {
  settings: SettingsPageProps;
}

function WebProxyCard({ settings }: ConnectionSettingsCardsProps) {
  const {
    onOpenWebVersion,
    onWebProxyPortChange,
    t,
    webProxyPort,
    webProxyPortLoading,
  } = settings;
  const [draft, setDraft] = useState<number | null>(webProxyPort ?? null);
  const closingRef = useRef(false);
  const webVersionUrl = webProxyPort ? `http://127.0.0.1:${webProxyPort}` : null;

  useEffect(() => {
    setDraft(webProxyPort ?? null);
  }, [webProxyPort]);

  if (!onWebProxyPortChange) return null;
  return (
    <section className="settings-card">
      <div className="settings-icon"><Network size={23} /></div>
      <div className="settings-card-content">
        <div className="settings-card-copy">
          <h3>{t("settings.webProxy.title")}</h3><p>{t("settings.webProxy.description")}</p>
        </div>
        <div className="settings-field web-proxy-settings-field">
          <label htmlFor="web-proxy-port">{t("settings.webProxy.port")}</label>
          {webVersionUrl && (
            <a
              className="web-proxy-address"
              href={webVersionUrl}
              target="_blank"
              rel="noreferrer"
              onClick={(event) => {
                if (!onOpenWebVersion) return;
                event.preventDefault();
                onOpenWebVersion(webVersionUrl);
              }}
            >
              {webVersionUrl}
            </a>
          )}
          <Space.Compact>
            <InputNumber
              id="web-proxy-port"
              min={1}
              max={65535}
              step={1}
              precision={0}
              value={draft}
              disabled={webProxyPortLoading}
              placeholder={t("settings.webProxy.disabled")}
              onChange={(value) => setDraft(typeof value === "number" ? value : null)}
              onBlur={(event) => {
                const closing = closingRef.current
                  || (event.relatedTarget as HTMLElement | null)?.dataset.webProxyClose === "true";
                if (!closing && draft !== (webProxyPort ?? null)) {
                  onWebProxyPortChange(draft);
                }
              }}
              onPressEnter={(event) => event.currentTarget.blur()}
            />
            <Button
              danger
              data-web-proxy-close="true"
              loading={webProxyPortLoading}
              disabled={!webProxyPort}
              onMouseDown={() => {
                closingRef.current = true;
              }}
              onClick={() => {
                setDraft(null);
                onWebProxyPortChange(null);
                closingRef.current = false;
              }}
            >
              {t("settings.webProxy.close")}
            </Button>
          </Space.Compact>
        </div>
      </div>
    </section>
  );
}

function CloudSettingsCardContent({ settings }: ConnectionSettingsCardsProps) {
  const {
    cloudAuthenticated,
    cloudBaseUrl,
    cloudBaseUrlLoading,
    onCloudBaseUrlSave,
    t,
  } = settings;
  const [draft, setDraft] = useState(cloudBaseUrl);
  const usingOfficialServer = draft.trim().replace(/\/+$/, "").toLowerCase()
    === DEFAULT_CLOUD_BASE_URL.toLowerCase();

  useEffect(() => {
    setDraft(cloudBaseUrl);
  }, [cloudBaseUrl]);

  return (
    <section className="settings-card">
      <div className="settings-icon"><Cloud size={23} /></div>
      <div className="settings-card-content">
        <div className="settings-card-copy">
          <h3>{t("settings.cloud.title")}</h3><p>{t("settings.cloud.description")}</p>
          <p className="cloud-settings-status">
            {cloudBaseUrl
              ? cloudAuthenticated ? t("settings.cloud.signedIn") : t("settings.cloud.enabled")
              : t("settings.cloud.localMode")}
          </p>
        </div>
        <div className="settings-field settings-field-wide">
          <label htmlFor="cloud-base-url">{t("settings.cloud.label")}</label>
          <Input
            id="cloud-base-url"
            value={draft}
            disabled={cloudBaseUrlLoading}
            allowClear
            placeholder={t("settings.cloud.placeholder")}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={() => {
              if (draft !== cloudBaseUrl) void onCloudBaseUrlSave(draft);
            }}
          />
          {!usingOfficialServer && (
            <Button
              size="small"
              disabled={cloudBaseUrlLoading}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                setDraft(DEFAULT_CLOUD_BASE_URL);
                void onCloudBaseUrlSave(DEFAULT_CLOUD_BASE_URL);
              }}
            >
              {t("settings.cloud.useOfficial")}
            </Button>
          )}
        </div>
      </div>
    </section>
  );
}

export function WebProxySettingsCard({ settings }: ConnectionSettingsCardsProps) {
  return <WebProxyCard settings={settings} />;
}

export function CloudSettingsCard({ settings }: ConnectionSettingsCardsProps) {
  return <CloudSettingsCardContent settings={settings} />;
}
