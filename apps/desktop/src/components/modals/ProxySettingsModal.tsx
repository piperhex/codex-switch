import { Modal, Switch } from "antd";
import { useLocalProxyLanKeys } from "../../hooks/useLocalProxyLanKeys";
import { useProxyEndpointAddresses } from "../../hooks/useProxyEndpointAddresses";
import { useProxySettings } from "../../hooks/useProxySettings";
import type { Translate } from "../../i18n";
import type { LocalProxyStatus } from "../../types";
import { ProxyEndpointList } from "./ProxyEndpointList";
import { ProxyLanKeyList } from "./ProxyLanKeyList";
import "./ProxySettingsModal.css";

interface ProxySettingsModalProps {
  open: boolean;
  proxy: LocalProxyStatus | null;
  loading: boolean;
  onClose: () => void;
  onSave: (enabled: boolean, apiKey?: string) => Promise<boolean>;
  notify: (message: string) => void;
  t: Translate;
}

export function ProxySettingsModal(options: ProxySettingsModalProps) {
  const { open, proxy, loading, onClose, onSave, notify, t } = options;
  const listenOnAllInterfaces = proxy?.listenOnAllInterfaces ?? false;
  const keyManager = useLocalProxyLanKeys({ open, notify, t });
  const hasConfiguredKey = keyManager.keys?.some((key) => key.enabled) ?? proxy?.hasLanApiKey ?? false;
  const disabled = loading || !proxy?.running;
  const settings = useProxySettings({ disabled: disabled || keyManager.saving, onSave });
  const busy = disabled || settings.saving || keyManager.saving;
  const endpoints = useProxyEndpointAddresses(open);

  return (
    <Modal open={open} width="80vw" centered title={t("providers.proxy.settings")}
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
        <ProxyLanKeyList open={open} manager={keyManager} disabled={busy}
          listenOnAllInterfaces={listenOnAllInterfaces} t={t} />
      </div>
    </Modal>
  );
}
