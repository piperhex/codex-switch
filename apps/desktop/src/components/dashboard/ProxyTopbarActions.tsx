import type { ReactNode } from "react";
import { Popover, Switch } from "antd";
import { ChevronDown, Shuffle } from "lucide-react";
import type { Translate } from "../../i18n";
import type { useProviderManager } from "../../hooks/useProviderManager";
import { CloudRecycleBin } from "../CloudRecycleBin";
import { ProxySessionManager } from "../ProxySessionManager";

interface ProxyTopbarActionsProps {
  cloudAuthenticated: boolean;
  manager: ReturnType<typeof useProviderManager>;
  showSessionManager?: boolean;
  trailingAction?: ReactNode;
  t: Translate;
}

export function ProxyTopbarActions({
  cloudAuthenticated,
  manager,
  showSessionManager = true,
  t,
  trailingAction,
}: ProxyTopbarActionsProps) {
  const localProxy = manager.localProxy;
  const proxyRunning = Boolean(localProxy?.running);
  return (
    <>
      {proxyRunning && <Popover trigger="hover" placement="bottom"
        mouseEnterDelay={0.08} mouseLeaveDelay={0.12}
        content={(
          <div className="proxy-auto-switch-menu">
            <div className="proxy-auto-switch-menu-item" title={t("providers.proxy.autoSwitchTooltip")}>
              <span>{t("providers.proxy.autoSwitch")}</span>
              <Switch size="small" checked={localProxy?.autoSwitchOnQuotaExhaustion}
                disabled={manager.proxyBusy}
                onChange={(enabled) => void manager.setProxyAutoSwitch(enabled)} />
            </div>
            <div className="proxy-auto-switch-menu-item" title={t("table.customPriorityTooltip")}>
              <span>{t("table.customPriorityEnabled")}</span>
              <Switch size="small" checked={localProxy?.customAutoSwitchPriorityEnabled}
                disabled={manager.proxyBusy || !localProxy?.autoSwitchOnQuotaExhaustion}
                onChange={(enabled) => void manager.setProxyCustomPriority(enabled)} />
            </div>
            <div className="proxy-auto-switch-menu-item"
              title={t("providers.proxy.autoDisableUnreachableTooltip")}>
              <span>{t("providers.proxy.autoDisableUnreachable")}</span>
              <Switch size="small" checked={localProxy?.autoDisableUnreachableAccounts}
                disabled={manager.proxyBusy || !localProxy?.autoSwitchOnQuotaExhaustion}
                onChange={(enabled) => void manager.setProxyAutoDisableUnreachable(enabled)} />
            </div>
          </div>
        )}>
        <button type="button"
          className={`refresh-all proxy-topbar-action${
            localProxy?.autoSwitchOnQuotaExhaustion ? " active" : ""
          }`}
          aria-label={t("providers.proxy.autoSwitch")}>
          <Shuffle size={14} />
          <span>{t("providers.proxy.autoSwitch")}</span>
          <ChevronDown size={12} />
        </button>
      </Popover>}
      {proxyRunning && showSessionManager && <ProxySessionManager t={t}
        triggerClassName="refresh-all proxy-topbar-action" />}
      {(proxyRunning || trailingAction) && <span className="account-security-actions">
        {proxyRunning && <CloudRecycleBin t={t} disabled={!cloudAuthenticated}
          triggerClassName="refresh-all proxy-topbar-action" />}
        {trailingAction}
      </span>}
    </>
  );
}
