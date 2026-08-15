import { useEffect, useId, useRef, useState } from "react";
import { Input, InputNumber, Modal, Switch } from "antd";
import { Waypoints } from "lucide-react";
import type { Translate } from "../../i18n";
import type { NetworkProxySettings } from "../../types";

interface NetworkProxyEditorProps {
  loading: boolean;
  onSave: (settings: NetworkProxySettings) => Promise<boolean>;
  t: Translate;
  value: NetworkProxySettings;
}

function validateProxy(settings: NetworkProxySettings, t: Translate) {
  if (!settings.enabled) return null;
  if (!settings.proxyPort || settings.proxyPort < 1 || settings.proxyPort > 65_535) {
    return t("settings.networkProxy.invalidPort");
  }
  const rawUrl = settings.proxyUrl.trim();
  if (!rawUrl) return t("settings.networkProxy.invalidAddress");
  try {
    const url = new URL(rawUrl.includes("://") ? rawUrl : `http://${rawUrl}`);
    const pathIsEmpty = url.pathname === "/" && !url.search && !url.hash;
    const invalidUrl = !["http:", "https:"].includes(url.protocol)
      || !url.hostname
      || Boolean(url.port)
      || !pathIsEmpty;
    if (invalidUrl) {
      return t("settings.networkProxy.invalidAddress");
    }
  } catch {
    return t("settings.networkProxy.invalidAddress");
  }
  return null;
}

function settingsMatch(first: NetworkProxySettings, second: NetworkProxySettings) {
  return first.enabled === second.enabled
    && first.proxyUrl.trim() === second.proxyUrl.trim()
    && first.proxyPort === second.proxyPort;
}

function NetworkProxyEditor({ loading, onSave, t, value }: NetworkProxyEditorProps) {
  const fieldId = useId();
  const [draft, setDraft] = useState(value);
  const [error, setError] = useState<string | null>(null);
  const savingRef = useRef(false);

  useEffect(() => {
    setDraft(value);
    setError(null);
  }, [value]);

  const save = async (settings: NetworkProxySettings) => {
    if (savingRef.current) return;
    const normalizedSettings = { ...settings, proxyUrl: settings.proxyUrl.trim() };
    const validationError = validateProxy(normalizedSettings, t);
    setError(validationError);
    if (validationError) return;
    if (settingsMatch(normalizedSettings, value)) return;
    savingRef.current = true;
    try {
      await onSave(normalizedSettings);
    } finally {
      savingRef.current = false;
    }
  };

  const updateEnabled = (enabled: boolean) => {
    const nextDraft = { ...draft, enabled };
    setDraft(nextDraft);
    void save(nextDraft);
  };

  return (
    <div className="network-proxy-editor" onBlur={(event) => {
      if (!event.currentTarget.contains(event.relatedTarget)) void save(draft);
    }}>
      <div className="network-proxy-toggle">
        <span>{t("settings.networkProxy.enabled")}</span>
        <Switch checked={draft.enabled} disabled={loading}
          onChange={updateEnabled} />
      </div>
      <div className="network-proxy-fields">
        <label htmlFor={`${fieldId}-url`}>{t("settings.networkProxy.address")}</label>
        <Input id={`${fieldId}-url`} className="network-proxy-url-input"
          value={draft.proxyUrl} disabled={loading || !draft.enabled}
          placeholder={t("settings.networkProxy.addressPlaceholder")}
          onChange={(event) => setDraft((current) => ({
            ...current,
            proxyUrl: event.target.value,
          }))} />
        <label htmlFor={`${fieldId}-port`}>{t("settings.networkProxy.port")}</label>
        <InputNumber id={`${fieldId}-port`} min={1} max={65_535} precision={0}
          value={draft.proxyPort} disabled={loading || !draft.enabled}
          placeholder={t("settings.networkProxy.portPlaceholder")}
          onChange={(proxyPort) => setDraft((current) => ({ ...current, proxyPort }))} />
      </div>
      {error && <p className="network-proxy-error">{error}</p>}
    </div>
  );
}

type NetworkProxyCardProps = NetworkProxyEditorProps;

export function NetworkProxySettingsCard(props: NetworkProxyCardProps) {
  const { t } = props;
  return (
    <section className="settings-card network-proxy-settings-card">
      <div className="settings-icon"><Waypoints size={23} /></div>
      <div className="settings-card-content">
        <div className="settings-card-copy">
          <h3>{t("settings.networkProxy.title")}</h3>
          <p>{t("settings.networkProxy.description")}</p>
        </div>
        <NetworkProxyEditor {...props} />
      </div>
    </section>
  );
}

interface NetworkProxyModalProps extends NetworkProxyEditorProps {
  onClose: () => void;
  open: boolean;
}

export function NetworkProxySettingsModal({ onClose, open, ...props }: NetworkProxyModalProps) {
  return (
    <Modal open={open} width={400} footer={null} destroyOnHidden
      title={props.t("settings.networkProxy.title")}
      onCancel={onClose} maskClosable={!props.loading} closable={!props.loading}>
      <p className="network-proxy-modal-copy">{props.t("settings.networkProxy.description")}</p>
      <NetworkProxyEditor {...props} />
    </Modal>
  );
}
