import { useState, type ReactNode } from "react";
import { Popover, Switch, Tooltip } from "antd";
import { ChevronDown, Settings, Shuffle } from "lucide-react";
import type { Translate } from "../../i18n";
import type { useProviderManager } from "../../hooks/useProviderManager";
import { CloudRecycleBin } from "../CloudRecycleBin";
import { ProxySessionManager } from "../ProxySessionManager";
import { AutoResetSettingsModal } from "./AutoResetSettingsModal";

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
  const [resetSettingsOpen, setResetSettingsOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const proxyRunning = Boolean(localProxy?.running);
  return (
    <>
      {proxyRunning && <Popover trigger="hover" placement="bottom"
        open={menuOpen && !resetSettingsOpen} onOpenChange={setMenuOpen}
        styles={{ body: { maxWidth: 400 } }}
        mouseEnterDelay={0.08} mouseLeaveDelay={0.12}
        content={(
          <div className="proxy-auto-switch-menu">
            <div className="proxy-auto-switch-menu-item" title={t("providers.proxy.autoSwitchTooltip")}>
              <span>{t("providers.proxy.autoSwitch")}</span>
              <Switch size="small" checked={localProxy?.autoSwitchOnQuotaExhaustion}
                disabled={manager.proxyBusy}
                onChange={(enabled) => void manager.setProxyAutoSwitch(enabled)} />
            </div>
            <Tooltip title={t("table.customPriorityTooltip")} styles={{ root: { maxWidth: 400 } }}>
              <div className="proxy-auto-switch-menu-item">
                <span>{t("table.customPriorityEnabled")}</span>
                <Switch size="small" checked={localProxy?.customAutoSwitchPriorityEnabled}
                  disabled={manager.proxyBusy || !localProxy?.autoSwitchOnQuotaExhaustion}
                  onChange={(enabled) => void manager.setProxyCustomPriority(enabled)} />
              </div>
            </Tooltip>
            <div className="proxy-auto-switch-menu-item" title={t("table.customThresholdTooltip")}>
              <span>{t("table.customThresholdEnabled")}</span>
              <Switch size="small" checked={localProxy?.customAutoSwitchThresholdEnabled}
                disabled={manager.proxyBusy || !localProxy?.autoSwitchOnQuotaExhaustion}
                onChange={(enabled) => void manager.setProxyCustomThreshold(enabled)} />
            </div>
            <div className="proxy-auto-switch-menu-item"
              title={t("providers.proxy.autoDisableUnreachableTooltip")}>
              <span>{t("providers.proxy.autoDisableUnreachable")}</span>
              <Switch size="small" checked={localProxy?.autoDisableUnreachableAccounts}
                disabled={manager.proxyBusy || !localProxy?.autoSwitchOnQuotaExhaustion}
                onChange={(enabled) => void manager.setProxyAutoDisableUnreachable(enabled)} />
            </div>
            <button type="button" className="proxy-auto-switch-menu-item"
              style={{ width: "100%", background: "none", border: 0, cursor: "pointer", color: "inherit" }}
              onClick={() => { setMenuOpen(false); setResetSettingsOpen(true); }}>
              <span>{t("autoReset.title")}</span><Settings size={15} />
            </button>
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
      {resetSettingsOpen && <AutoResetSettingsModal t={t}
        concurrent={Boolean(localProxy?.concurrentAccountRoutingEnabled)}
        onClose={() => setResetSettingsOpen(false)} />}
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
