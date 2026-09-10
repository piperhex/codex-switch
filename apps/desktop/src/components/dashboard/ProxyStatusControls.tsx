import { Popconfirm, Switch, Tooltip } from "antd";
import type { Translate } from "../../i18n";
import type { useProviderManager } from "../../hooks/useProviderManager";
import { CodexConnectionControl } from "./CodexConnectionControl";
import { ProxyCopyDropdown } from "./ProxyCopyDropdown";

type ProviderManager = ReturnType<typeof useProviderManager>;

interface ProxyStatusControlsProps {
  clientOperation: "start" | "restart" | null;
  onClientOperationChange: (operation: "start" | "restart" | null) => void;
  manager: ProviderManager;
  notify: (message: string) => void;
  onRequestLanAccess: () => void;
  startDisabledReason?: string;
  t: Translate;
}

export function ProxyStatusControls(options: ProxyStatusControlsProps) {
  const {
    clientOperation,
    onClientOperationChange,
    manager,
    notify,
    onRequestLanAccess,
    startDisabledReason,
    t,
  } = options;
  const running = Boolean(manager.localProxy?.running);
  const controlsBusy = manager.proxyBusy || clientOperation !== null;
  const toggleDisabled = controlsBusy || (!running && Boolean(startDisabledReason));

  const changeLanListening = (enabled: boolean) => {
    if (controlsBusy) return;
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
          if (!toggleDisabled && !checked && running) void manager.stopProxy();
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
      disabled={controlsBusy} onConfirm={() => { if (!toggleDisabled) void manager.startProxy(); }}>
      {statusSwitch}
    </Popconfirm>
  );

  return (
    <div className={`window-titlebar-proxy${running ? " is-running" : ""}`}>
      <CodexConnectionControl blocked={controlsBusy}
        onOperationChange={onClientOperationChange} notify={notify} t={t} />
      {statusControl}
      {running && (
        <span className="window-titlebar-proxy-lan">
          <span>{t("providers.proxy.listenLan")}</span>
          <Switch className="window-titlebar-proxy-lan-switch" size="small"
            checked={manager.localProxy?.listenOnAllInterfaces ?? false} loading={manager.proxyBusy}
            disabled={controlsBusy} aria-label={t("providers.proxy.listenLan")}
            onChange={changeLanListening} />
          {manager.localProxy && <ProxyCopyDropdown proxy={manager.localProxy} busy={manager.proxyBusy}
            copyApiKey={manager.copyProxyLanApiKey} notify={notify} t={t} />}
        </span>
      )}
    </div>
  );
}
