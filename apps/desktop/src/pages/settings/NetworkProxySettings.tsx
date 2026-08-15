import { useEffect, useId, useState } from "react";
import { Button, Input, InputNumber, Modal, Switch } from "antd";
import { Waypoints } from "lucide-react";
import type { Translate } from "../../i18n";
import type { NetworkProxySettings } from "../../types";

interface NetworkProxyEditorProps {
  loading: boolean;
  onSave: (settings: NetworkProxySettings) => Promise<boolean>;
  onSaved?: () => void;
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

function NetworkProxyEditor({ loading, onSave, onSaved, t, value }: NetworkProxyEditorProps) {
  const fieldId = useId();
  const [draft, setDraft] = useState(value);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDraft(value);
    setError(null);
  }, [value]);

  const save = async () => {
    const validationError = validateProxy(draft, t);
    setError(validationError);
    if (validationError) return;
    if (await onSave({ ...draft, proxyUrl: draft.proxyUrl.trim() })) onSaved?.();
  };

  return (
    <div className="network-proxy-editor">
      <div className="network-proxy-toggle">
        <span>{t("settings.networkProxy.enabled")}</span>
        <Switch checked={draft.enabled} disabled={loading}
          onChange={(enabled) => setDraft((current) => ({ ...current, enabled }))} />
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
      <Button type="primary" loading={loading} onClick={() => void save()}>
        {t("settings.networkProxy.save")}
      </Button>
    </div>
  );
}

type NetworkProxyCardProps = Omit<NetworkProxyEditorProps, "onSaved">;

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
      <NetworkProxyEditor {...props} onSaved={onClose} />
    </Modal>
  );
}
