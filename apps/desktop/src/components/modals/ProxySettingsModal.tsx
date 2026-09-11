import { Button, Input, Modal, Switch } from "antd";
import { Copy, Save, Sparkles } from "lucide-react";
import { useProxyEndpointAddresses } from "../../hooks/useProxyEndpointAddresses";
import { useProxySettings } from "../../hooks/useProxySettings";
import type { Translate } from "../../i18n";
import type { LocalProxyStatus } from "../../types";
import { ProxyEndpointList } from "./ProxyEndpointList";
import "./ProxySettingsModal.css";

interface ProxySettingsModalProps {
  open: boolean;
  proxy: LocalProxyStatus | null;
  loading: boolean;
  onClose: () => void;
  onSave: (enabled: boolean, apiKey?: string) => Promise<boolean>;
  onCopyApiKey: () => Promise<void>;
  notify: (message: string) => void;
  t: Translate;
}

export function ProxySettingsModal(options: ProxySettingsModalProps) {
  const { open, proxy, loading, onClose, onSave, onCopyApiKey, notify, t } = options;
  const listenOnAllInterfaces = proxy?.listenOnAllInterfaces ?? false;
  const hasConfiguredKey = proxy?.hasLanApiKey ?? false;
  const disabled = loading || !proxy?.running;
  const settings = useProxySettings({ open, disabled, listenOnAllInterfaces, onSave, onCopyApiKey, notify, t });
  const busy = disabled || settings.saving;
  const endpoints = useProxyEndpointAddresses(open);

  return (
    <Modal open={open} width={440} centered title={t("providers.proxy.settings")}
      className="proxy-settings-modal" onCancel={onClose} footer={null}>
      <div className="proxy-settings-content">
        {!proxy?.running && <p className="proxy-settings-notice">{t("providers.proxy.settingsStopped")}</p>}
        <section className="proxy-settings-section" aria-labelledby="proxy-lan-title">
          <div className="proxy-settings-section-heading">
            <h3 id="proxy-lan-title">{t("providers.proxy.listenLan")}</h3>
            <Switch size="small" checked={listenOnAllInterfaces} loading={settings.saving}
              disabled={busy || (!listenOnAllInterfaces && !hasConfiguredKey)}
              aria-label={t("providers.proxy.listenLan")}
              onChange={(enabled) => void settings.changeListening(enabled)} />
          </div>
          <p>{t("providers.proxy.lanAccessDescription")}</p>
          {!hasConfiguredKey && <p>{t("providers.proxy.saveKeyBeforeLan")}</p>}
        </section>
        <ProxyEndpointList endpoints={endpoints} port={proxy?.port} listenOnAllInterfaces={listenOnAllInterfaces}
          notify={notify} t={t} />
        <section className="proxy-settings-section" aria-labelledby="proxy-api-key-title">
          <h3 id="proxy-api-key-title">
            <label htmlFor="local-proxy-api-key">{t("providers.proxy.lanApiKey")}</label>
          </h3>
          <Input.Password id="local-proxy-api-key" value={settings.apiKey} disabled={busy}
            autoComplete="new-password"
            placeholder={t(hasConfiguredKey ? "providers.proxy.configuredLanApiKey"
              : "providers.proxy.lanApiKeyPlaceholder")}
            onChange={(event) => settings.setApiKey(event.target.value)}
            onPressEnter={() => void settings.saveApiKey()} />
          <div className="proxy-settings-key-actions">
            <Button disabled={busy} icon={<Sparkles size={14} />} onClick={settings.generateApiKey}>
              {t("providers.proxy.generateApiKey")}
            </Button>
            <Button type="primary" disabled={busy || !settings.normalizedApiKey} loading={settings.saving}
              icon={<Save size={14} />} onClick={() => void settings.saveApiKey()}>
              {t(hasConfiguredKey ? "providers.proxy.updateApiKey" : "providers.proxy.saveApiKey")}
            </Button>
            <Button disabled={loading || settings.saving || (!settings.normalizedApiKey && !hasConfiguredKey)}
              icon={<Copy size={14} />} aria-label={t("providers.proxy.copyLanApiKey")}
              onClick={() => void settings.copyApiKey()}>
              {t("providers.proxy.copyApiKey")}
            </Button>
          </div>
          <p role="status">{t(settings.normalizedApiKey
            ? "providers.proxy.apiKeyUnsaved" : "providers.proxy.apiKeyUsageHint")}</p>
          {hasConfiguredKey && <p>{t("providers.proxy.apiKeyUpdateHint")}</p>}
        </section>
      </div>
    </Modal>
  );
}
