import { Popconfirm, Switch, Tooltip } from "antd";
import { Copy } from "lucide-react";
import type { Translate } from "../../i18n";
import type { useProviderManager } from "../../hooks/useProviderManager";

type ProviderManager = ReturnType<typeof useProviderManager>;

interface ProxyStatusControlsProps {
  customTitlebarEnabled: boolean;
  manager: ProviderManager;
  notify: (message: string) => void;
  onRequestLanAccess: () => void;
  startDisabledReason?: string;
  t: Translate;
}

export function ProxyStatusControls(options: ProxyStatusControlsProps) {
  const {
    customTitlebarEnabled,
    manager,
    notify,
    onRequestLanAccess,
    startDisabledReason,
    t,
  } = options;
  const running = Boolean(manager.localProxy?.running);
  const baseUrl = manager.localProxy?.port
    ? `http://${manager.localProxy.address}:${manager.localProxy.port}/v1`
    : "--";
  const toggleDisabled = manager.proxyBusy || (!running && Boolean(startDisabledReason));

  const copyBaseUrl = () => {
    if (!manager.localProxy) return;
    void navigator.clipboard.writeText(baseUrl)
      .then(() => notify(t("providers.proxy.endpointCopied")))
      .catch((error) => notify(String(error)));
  };
  const changeLanListening = (enabled: boolean) => {
    if (enabled) onRequestLanAccess();
    else void manager.setProxyListenOnAllInterfaces(false);
  };
  const statusSwitch = (
    <span className="window-titlebar-proxy-status"
      title={t(running ? "providers.proxy.stop" : "providers.proxy.start")}>
      <span>{t(running ? "providers.proxy.localRunning" : "providers.proxy.stopped")}</span>
      <Switch className="window-titlebar-proxy-switch" size="small" checked={running}
        loading={manager.proxyBusy} disabled={toggleDisabled}
        aria-label={t(running ? "providers.proxy.stop" : "providers.proxy.start")}
        onChange={(checked) => {
          if (!checked && running) void manager.stopProxy();
        }} />
    </span>
  );
  const disabledReason = running ? undefined : startDisabledReason;
  const statusControl = disabledReason ? (
    <Tooltip title={disabledReason}>
      <span className="window-titlebar-proxy-status-wrap">{statusSwitch}</span>
    </Tooltip>
  ) : running ? statusSwitch : (
    <Popconfirm title={t("providers.proxy.startConfirmTitle")}
      description={<span className="proxy-start-confirm-description">{t("providers.proxy.description")}</span>}
      okText={t("providers.proxy.start")} cancelText={t("providers.proxy.cancel")}
      disabled={manager.proxyBusy} onConfirm={() => void manager.startProxy()}>
      {statusSwitch}
    </Popconfirm>
  );

  return (
    <div className={`window-titlebar-proxy${
      !customTitlebarEnabled ? " web-proxy-controls" : ""
    }${running ? " is-running" : ""}`}>
      {statusControl}
      <button type="button" className="window-titlebar-proxy-endpoint-copy"
        disabled={!manager.localProxy?.port}
        aria-label={t("providers.proxy.copyEndpoint")} title={t("providers.proxy.copyEndpoint")}
        onClick={copyBaseUrl}>
        <Copy size={12} aria-hidden="true" />
      </button>
      {running && (
        <span className="window-titlebar-proxy-lan" title="0.0.0.0">
          <span>{t("providers.proxy.listenLan")}</span>
          <Switch className="window-titlebar-proxy-lan-switch" size="small"
            checked={manager.localProxy?.listenOnAllInterfaces ?? false} loading={manager.proxyBusy}
            disabled={manager.proxyBusy} aria-label={t("providers.proxy.listenLan")}
            onChange={changeLanListening} />
          <Tooltip title={manager.localProxy?.hasLanApiKey
            ? t("providers.proxy.copyLanApiKey") : t("providers.proxy.copyLanApiKeyUnavailable")}>
            <span className="window-titlebar-proxy-lan-copy-wrap">
              <button type="button" className="window-titlebar-proxy-lan-copy"
                disabled={manager.proxyBusy || !manager.localProxy?.hasLanApiKey}
                aria-label={t("providers.proxy.copyLanApiKey")}
                onClick={() => void manager.copyProxyLanApiKey()}>
                <Copy size={12} aria-hidden="true" />
              </button>
            </span>
          </Tooltip>
        </span>
      )}
    </div>
  );
}
