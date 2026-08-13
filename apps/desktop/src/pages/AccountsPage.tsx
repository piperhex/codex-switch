import type { ReactNode } from "react";
import { ArrowRight, LogIn, RefreshCw } from "lucide-react";
import type { Language, Translate } from "../i18n";
import type { AccountDisplayMode } from "../hooks/useAccountDisplayMode";
import type { Account, LocalProxyStatus, ResetCreditsLoadState } from "../types";
import { AccountTable } from "../components/accounts/AccountTable";

export function AccountsPage({
  accounts,
  loading,
  busyAccountId,
  localProxy,
  proxyBusy,
  resetCredits,
  onAdd,
  onSwitch,
  onDeactivate,
  onCopyAuthJson,
  onRefresh,
  onDelete,
  onConsumeQuotaMany,
  onDeleteMany,
  onEnableMany,
  onDisableMany,
  onAutoSwitchEnabledChange,
  autoSwitchBusyAccountId,
  onAutoSwitchPriorityChange,
  autoSwitchPriorityBusyAccountId,
  onSaveNote,
  onLoadResetCredits,
  onUseResetCredit,
  resetCreditBusyAccountId,
  onImageAccountChange,
  onOpenaiAuthAccountChange,
  onConcurrentRoutingChange,
  privacyMode,
  hideAccountNotes,
  showUsageNetworkErrors,
  displayMode,
  tokenUsageRefreshSeconds,
  proxyControls,
  language,
  t,
}: {
  accounts: Account[];
  loading: boolean;
  busyAccountId: string | null;
  localProxy: LocalProxyStatus | null;
  proxyBusy: boolean;
  resetCredits: Record<string, ResetCreditsLoadState>;
  onAdd: () => void;
  onSwitch: (id: string) => void;
  onDeactivate: (id: string) => void;
  onCopyAuthJson: (id: string) => void;
  onRefresh: (id: string) => void;
  onDelete: (id: string) => void;
  onConsumeQuotaMany: (ids: string[]) => Promise<string[]>;
  onDeleteMany: (ids: string[]) => Promise<string[]>;
  onEnableMany: (ids: string[]) => Promise<string[]>;
  onDisableMany: (ids: string[]) => Promise<string[]>;
  onAutoSwitchEnabledChange: (id: string, enabled: boolean) => void;
  autoSwitchBusyAccountId: string | null;
  onAutoSwitchPriorityChange: (id: string, priority: number) => Promise<boolean>;
  autoSwitchPriorityBusyAccountId: string | null;
  onSaveNote: (id: string, note: string, expiresAt: string) => Promise<boolean>;
  onLoadResetCredits: (id: string, force?: boolean) => void;
  onUseResetCredit: (id: string) => void;
  resetCreditBusyAccountId: string | null;
  onImageAccountChange: (accountId: string | null) => void;
  onOpenaiAuthAccountChange: (accountId: string | null) => void;
  onConcurrentRoutingChange: (enabled: boolean) => void;
  privacyMode: boolean;
  hideAccountNotes: boolean;
  showUsageNetworkErrors: boolean;
  displayMode: AccountDisplayMode;
  tokenUsageRefreshSeconds: number;
  proxyControls?: ReactNode;
  language: Language;
  t: Translate;
}) {
  const hotSwitchEnabled = Boolean(localProxy?.running);
  if (loading) {
    return (
      <div className="accounts-page">
        <div className="loading-state"><RefreshCw className="spin" />{t("accounts.loading")}</div>
      </div>
    );
  }
  if (!accounts.length) {
    return (
      <div className="accounts-page">
        {proxyControls && <div className="account-empty-proxy-toolbar">{proxyControls}</div>}
        <div className="empty-state">
          <div><LogIn size={28} /></div><h2>{t("accounts.empty.title")}</h2>
          <p>{t("accounts.empty.description")}</p>
          <button className="primary-button" onClick={onAdd}>
            {t("accounts.empty.addFirst")}<ArrowRight size={17} />
          </button>
        </div>
      </div>
    );
  }
  return (
    <div className="accounts-page">
      <AccountTable accounts={accounts} busyAccountId={busyAccountId}
        onSwitch={onSwitch} onDeactivate={onDeactivate}
        onCopyAuthJson={onCopyAuthJson} onRefresh={onRefresh} onDelete={onDelete}
        onConsumeQuotaMany={onConsumeQuotaMany} onDeleteMany={onDeleteMany}
        onEnableMany={onEnableMany} onDisableMany={onDisableMany}
        onAutoSwitchEnabledChange={onAutoSwitchEnabledChange} autoSwitchBusyAccountId={autoSwitchBusyAccountId}
        onAutoSwitchPriorityChange={onAutoSwitchPriorityChange}
        autoSwitchPriorityBusyAccountId={autoSwitchPriorityBusyAccountId}
        autoSwitchOnQuotaExhaustion={localProxy?.autoSwitchOnQuotaExhaustion ?? false}
        customAutoSwitchPriorityEnabled={localProxy?.customAutoSwitchPriorityEnabled ?? false}
        onSaveNote={onSaveNote}
        resetCredits={resetCredits} onLoadResetCredits={onLoadResetCredits}
        onUseResetCredit={onUseResetCredit} resetCreditBusyAccountId={resetCreditBusyAccountId}
        hotSwitchEnabled={hotSwitchEnabled} privacyMode={privacyMode}
        hideAccountNotes={hideAccountNotes}
        concurrentAccountRoutingEnabled={localProxy?.concurrentAccountRoutingEnabled ?? false}
        concurrentAccountRoutingBusy={proxyBusy}
        onConcurrentAccountRoutingChange={onConcurrentRoutingChange}
        imageGenerationAccountId={localProxy?.imageGenerationAccountId ?? null}
        imageAccountBusy={proxyBusy}
        onImageAccountChange={onImageAccountChange}
        showUsageNetworkErrors={showUsageNetworkErrors} displayMode={displayMode}
        openaiAuthAccountId={localProxy?.openaiAuthAccountId ?? null} openaiAuthBusy={proxyBusy}
        onOpenaiAuthAccountChange={onOpenaiAuthAccountChange}
        tokenUsageRefreshSeconds={tokenUsageRefreshSeconds}
        proxyControls={proxyControls}
        language={language} t={t} />
    </div>
  );
}
