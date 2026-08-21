import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  AutoComplete,
  Button,
  Checkbox,
  Dropdown,
  Popconfirm,
  Space,
  Switch,
  Table,
  Tag,
  Tooltip,
} from "antd";
import type { TableProps } from "antd";
import type { ColumnsType } from "antd/es/table";
import {
  CalendarClock,
  Check,
  Columns3,
  Copy,
  Gauge,
  LogIn,
  LogOut,
  MoreHorizontal,
  Pencil,
  RefreshCw,
  RotateCcw,
  ToggleLeft,
  ToggleRight,
  Trash2,
  X,
} from "lucide-react";
import {
  loadAccountTokenUsage,
  loadProxySessions,
  subscribeToTokenUsageChanges,
} from "../../../api/backend";
import type { Language, Translate } from "../../../i18n";
import type { AccountDisplayMode } from "../../../hooks/useAccountDisplayMode";
import {
  DEFAULT_GPT_5_6_SOL_CONTEXT_WINDOW_K,
  GPT_5_6_SOL_CONTEXT_WINDOW_OPTIONS_K,
  type ModelContextWindowError,
  useGpt56SolContextWindow,
} from "../../../hooks/useGpt56SolContextWindow";
import type {
  Account,
  AccountDetailsDraft,
  AccountTokenUsageTotals,
  ResetCreditsLoadState,
} from "../../../types";
import { accountExpirationDate } from "../../../utils/expiration";
import { initials } from "../../../utils/format";
import { shouldShowUsageError } from "../../../utils/usageErrors";
import {
  DailyTokenUsageTooltip,
  EMPTY_TOKEN_TOTALS,
  type TokenTypeTotals,
} from "../../DailyTokenUsageTooltip";
import { AccountNoteModal } from "../../modals/AccountNoteModal";
import { ResetCreditsPanel } from "../ResetCreditsPanel";
import { UsageMeter, UsageRefreshAge } from "../UsageMeter";
import "./index.less";
import {
  AccountNoteEditButton,
  AccountResetCreditCount,
  AutoSwitchPriorityInput,
  canEditAccountMetadata,
  CompactDailyTokenChart,
  CopyableAccountEmail,
  needsAccountAttention,
  resetCreditsCount,
  ResetCreditsModal,
  tokenUsageMatchesAccount,
  totalsForAccount,
} from "../AccountTableParts";

interface AccountTableProps {
  active: boolean;
  accounts: Account[];
  busyAccountId: string | null;
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
  autoSwitchOnQuotaExhaustion: boolean;
  customAutoSwitchPriorityEnabled: boolean;
  onSaveNote: (id: string, details: AccountDetailsDraft) => Promise<boolean>;
  onLoadAccountDetails: (id: string) => Promise<Account | null>;
  resetCredits: Record<string, ResetCreditsLoadState>;
  onLoadResetCredits: (id: string, force?: boolean) => void;
  onUseResetCredit: (id: string) => void;
  resetCreditBusyAccountId: string | null;
  hotSwitchEnabled: boolean;
  concurrentAccountRoutingEnabled: boolean;
  concurrentAccountRoutingBusy: boolean;
  onConcurrentAccountRoutingChange: (enabled: boolean) => void;
  openaiAuthAccountId: string | null;
  openaiAuthBusy: boolean;
  onOpenaiAuthAccountChange: (accountId: string | null) => void;
  privacyMode: boolean;
  hideAccountNotes: boolean;
  showUsageNetworkErrors: boolean;
  displayMode: AccountDisplayMode;
  tokenUsageRefreshSeconds: number;
  proxyControls?: ReactNode;
  language: Language;
  t: Translate;
}

const USAGE_SORT_STORAGE_KEY = "codex-switch:account-table-usage-sort";
const HIDDEN_COLUMNS_STORAGE_KEY = "codex-switch:account-table-hidden-columns";
const GPT_5_6_SOL_CONTEXT_WINDOW_OPTIONS = GPT_5_6_SOL_CONTEXT_WINDOW_OPTIONS_K.map((value) => ({
  label: `${value}K`,
  value: String(value),
}));

function modelContextWindowTooltipKey(error: ModelContextWindowError) {
  if (error === "invalid") return "table.modelContextWindowInvalid" as const;
  if (error === "save") return "table.modelContextWindowSaveError" as const;
  return "table.modelContextWindowTooltip" as const;
}

type UsageSortColumn = "fiveHours" | "oneWeek";
type UsageSortOrder = "ascend" | "descend";
const ACCOUNT_TABLE_COLUMN_KEYS = [
  "account",
  "fiveHours",
  "oneWeek",
  "tokenTotals",
  "autoSwitchPriority",
  "actions",
] as const;
type AccountTableColumnKey = typeof ACCOUNT_TABLE_COLUMN_KEYS[number];

interface UsageSortPreference {
  column: UsageSortColumn;
  order: UsageSortOrder;
}

interface AccountContextMenu {
  accountId: string;
  x: number;
  y: number;
}

const ACCOUNT_CONTEXT_MENU_WIDTH = 220;
const ACCOUNT_CONTEXT_MENU_HEIGHT = {
  hotSwitch: 352,
  directSwitch: 276,
} as const;

function contextMenuPosition(event: { clientX: number; clientY: number }, menuHeight: number) {
  return {
    x: Math.max(8, Math.min(event.clientX, window.innerWidth - ACCOUNT_CONTEXT_MENU_WIDTH - 8)),
    y: Math.max(8, Math.min(event.clientY, window.innerHeight - menuHeight - 8)),
  };
}

function maskAccountEmail(email: string) {
  if (email.length <= 10) return "*****";
  return `${email.slice(0, 5)}*****${email.slice(-5)}`;
}

function isUsageSortColumn(value: unknown): value is UsageSortColumn {
  return value === "fiveHours" || value === "oneWeek";
}

function isUsageSortOrder(value: unknown): value is UsageSortOrder {
  return value === "ascend" || value === "descend";
}

function loadUsageSortPreference(): UsageSortPreference | null {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(USAGE_SORT_STORAGE_KEY) ?? "null");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const preference = parsed as Partial<UsageSortPreference>;
    if (!isUsageSortColumn(preference.column) || !isUsageSortOrder(preference.order)) return null;
    return { column: preference.column, order: preference.order };
  } catch {
    return null;
  }
}

function persistUsageSortPreference(preference: UsageSortPreference | null) {
  if (!preference) {
    window.localStorage.removeItem(USAGE_SORT_STORAGE_KEY);
    return;
  }
  window.localStorage.setItem(USAGE_SORT_STORAGE_KEY, JSON.stringify(preference));
}

function isAccountTableColumnKey(value: unknown): value is AccountTableColumnKey {
  return typeof value === "string"
    && (ACCOUNT_TABLE_COLUMN_KEYS as readonly string[]).includes(value);
}

function loadHiddenColumns(): AccountTableColumnKey[] {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(HIDDEN_COLUMNS_STORAGE_KEY) ?? "[]");
    if (!Array.isArray(parsed)) return [];
    return [...new Set(parsed.filter(isAccountTableColumnKey))];
  } catch {
    return [];
  }
}

function persistHiddenColumns(columns: AccountTableColumnKey[]) {
  window.localStorage.setItem(HIDDEN_COLUMNS_STORAGE_KEY, JSON.stringify(columns));
}

function usageRemainingSortValue(window: Account["usage"]["primary"]) {
  return typeof window?.remainingPercent === "number" ? window.remainingPercent : Number.NEGATIVE_INFINITY;
}

function compareUsageRemaining(
  left: Account,
  right: Account,
  usageWindow: "primary" | "secondary",
) {
  return usageRemainingSortValue(left.usage[usageWindow]) - usageRemainingSortValue(right.usage[usageWindow]);
}

function isAccountDisabled(account: Account, hotSwitchEnabled: boolean) {
  return hotSwitchEnabled && !account.autoSwitchEnabled;
}

function canReceiveConcurrentConversation(account: Account) {
  return account.autoSwitchEnabled
    && !(account.usage.primary && account.usage.primary.remainingPercent <= 0);
}

function isAccountHighlighted(account: Account, concurrentRoutingActive: boolean) {
  return concurrentRoutingActive
    ? canReceiveConcurrentConversation(account)
    : account.active;
}

function compareKeepingAttentionLast(
  left: Account,
  right: Account,
  hotSwitchEnabled: boolean,
  showUsageNetworkErrors: boolean,
  sortOrder: UsageSortOrder | null | undefined,
  compare: (left: Account, right: Account) => number,
) {
  const attentionOrder = Number(needsAccountAttention(left, hotSwitchEnabled, showUsageNetworkErrors))
    - Number(needsAccountAttention(right, hotSwitchEnabled, showUsageNetworkErrors));
  if (attentionOrder !== 0) return sortOrder === "descend" ? -attentionOrder : attentionOrder;
  return compare(left, right);
}

export function AccountTable({
  active,
  accounts,
  busyAccountId,
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
  autoSwitchOnQuotaExhaustion,
  customAutoSwitchPriorityEnabled,
  onSaveNote,
  onLoadAccountDetails,
  resetCredits,
  onLoadResetCredits,
  onUseResetCredit,
  resetCreditBusyAccountId,
  hotSwitchEnabled,
  concurrentAccountRoutingEnabled,
  concurrentAccountRoutingBusy,
  onConcurrentAccountRoutingChange,
  openaiAuthAccountId,
  openaiAuthBusy,
  onOpenaiAuthAccountChange,
  privacyMode,
  hideAccountNotes,
  showUsageNetworkErrors,
  displayMode,
  tokenUsageRefreshSeconds,
  proxyControls,
  language,
  t,
}: AccountTableProps) {
  const concurrentRoutingActive = hotSwitchEnabled && concurrentAccountRoutingEnabled;
  const tableWrapRef = useRef<HTMLDivElement>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);
  const [editingAccount, setEditingAccount] = useState<Account | null>(null);
  const [loadingAccountDetailsId, setLoadingAccountDetailsId] = useState<string | null>(null);
  const [resetCreditsAccount, setResetCreditsAccount] = useState<Account | null>(null);
  const [contextMenu, setContextMenu] = useState<AccountContextMenu | null>(null);
  const [tableActionMenuAccountId, setTableActionMenuAccountId] = useState<string | null>(null);
  const [selectedAccountIds, setSelectedAccountIds] = useState<string[]>([]);
  const [bulkConsumeQuotaConfirmOpen, setBulkConsumeQuotaConfirmOpen] = useState(false);
  const [bulkConsumeQuotaBusy, setBulkConsumeQuotaBusy] = useState(false);
  const [bulkDeleteBusy, setBulkDeleteBusy] = useState(false);
  const [bulkEnableBusy, setBulkEnableBusy] = useState(false);
  const [bulkDisableBusy, setBulkDisableBusy] = useState(false);
  const [openaiAuthPendingAccountId, setOpenaiAuthPendingAccountId] = useState<string | null>(null);
  const [usageSort, setUsageSort] = useState<UsageSortPreference | null>(loadUsageSortPreference);
  const [hiddenColumns, setHiddenColumns] = useState<AccountTableColumnKey[]>(loadHiddenColumns);
  const modelContextWindow = useGpt56SolContextWindow();
  const [tableScrollY, setTableScrollY] = useState(0);
  const [accountTokenUsage, setAccountTokenUsage] = useState<AccountTokenUsageTotals[]>([]);
  const [accountConversationCounts, setAccountConversationCounts] = useState<Record<string, number>>({});
  const [cardTopbarHost, setCardTopbarHost] = useState<HTMLElement | null>(null);
  const openAccountDetails = (account: Account) => {
    setEditingAccount(account);
    setLoadingAccountDetailsId(account.id);
    void onLoadAccountDetails(account.id)
      .then((latest) => {
        setEditingAccount((current) => current?.id === account.id ? latest : current);
      })
      .finally(() => {
        setLoadingAccountDetailsId((current) => current === account.id ? null : current);
      });
  };
  useEffect(() => {
    const showCardControls = active && displayMode === "cards";
    setCardTopbarHost(showCardControls ? document.getElementById("account-card-topbar-controls") : null);
  }, [active, displayMode]);
  useEffect(() => {
    if (!active || displayMode !== "table") {
      setTableScrollY(0);
      return undefined;
    }
    const tableWrap = tableWrapRef.current;
    if (!tableWrap) return undefined;

    const updateScrollHeight = () => {
      const headerHeight = tableWrap.querySelector(".ant-table-thead")?.getBoundingClientRect().height ?? 0;
      const toolbarHeight = tableWrap.querySelector(".account-table-toolbar")?.getBoundingClientRect().height ?? 0;
      setTableScrollY(Math.max(1, Math.floor(tableWrap.clientHeight - headerHeight - toolbarHeight)));
    };
    const observer = new ResizeObserver(updateScrollHeight);
    observer.observe(tableWrap);
    updateScrollHeight();
    return () => observer.disconnect();
  }, [active, displayMode]);
  useEffect(() => {
    const closeContextMenu = (event: PointerEvent) => {
      if (event.target instanceof Element && event.target.closest(".ant-popconfirm")) return;
      if (!contextMenuRef.current?.contains(event.target as Node)) setContextMenu(null);
    };
    document.addEventListener("pointerdown", closeContextMenu);
    return () => document.removeEventListener("pointerdown", closeContextMenu);
  }, []);
  useEffect(() => {
    if (!hotSwitchEnabled) {
      setAccountTokenUsage([]);
      return undefined;
    }
    let active = true;
    let refreshing = false;
    const refresh = async () => {
      if (refreshing) return;
      refreshing = true;
      try {
        const today = new Date();
        const startTs = new Date(
          today.getFullYear(),
          today.getMonth(),
          today.getDate(),
        ).getTime() / 1_000;
        const totals = await loadAccountTokenUsage(startTs);
        if (active) setAccountTokenUsage(totals);
      } catch {
        // Keep the last successful totals; quota rendering must not fail with token statistics.
      } finally {
        refreshing = false;
      }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), Math.max(1, tokenUsageRefreshSeconds) * 1000);
    const unsubscribe = subscribeToTokenUsageChanges(() => void refresh());
    return () => {
      active = false;
      window.clearInterval(timer);
      unsubscribe();
    };
  }, [hotSwitchEnabled, tokenUsageRefreshSeconds]);
  useEffect(() => {
    if (!concurrentRoutingActive) {
      setAccountConversationCounts({});
      return undefined;
    }
    let active = true;
    let refreshing = false;
    const refresh = async () => {
      if (refreshing) return;
      refreshing = true;
      try {
        const accountIds = new Set(accounts.map((account) => account.id));
        const counts: Record<string, number> = {};
        (await loadProxySessions()).forEach((session) => {
          const accountId = session.accountId;
          if (session.concurrentRouted && session.activeRequests > 0
            && accountId && accountIds.has(accountId)) {
            counts[accountId] = (counts[accountId] ?? 0) + 1;
          }
        });
        if (active) setAccountConversationCounts(counts);
      } catch {
        // Keep the last successful counts while the proxy session list is unavailable.
      } finally {
        refreshing = false;
      }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 2_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [accounts, concurrentRoutingActive]);
  useEffect(() => {
    const accountIds = new Set(accounts.map((account) => account.id));
    setSelectedAccountIds((current) => {
      const next = current.filter((id) => accountIds.has(id));
      return next.length === current.length && next.every((id, index) => id === current[index]) ? current : next;
    });
  }, [accounts]);
  useEffect(() => {
    if (!openaiAuthBusy) setOpenaiAuthPendingAccountId(null);
  }, [openaiAuthBusy]);
  const customPriorityActive = hotSwitchEnabled
    && autoSwitchOnQuotaExhaustion
    && customAutoSwitchPriorityEnabled;
  const todayTokenTotalsByAccount = useMemo(() => {
    const totals = new Map<string, TokenTypeTotals>();
    accountTokenUsage.forEach((usage) => {
      const account = accounts.find((candidate) => tokenUsageMatchesAccount(usage, candidate));
      if (!account) return;
      const current = totals.get(account.id) ?? { ...EMPTY_TOKEN_TOTALS };
      current.total += usage.totalTokens;
      current.input += usage.inputTokens;
      current.output += usage.outputTokens;
      current.reasoning += usage.reasoningTokens;
      current.cached += usage.cachedTokens;
      totals.set(account.id, current);
    });
    return totals;
  }, [accountTokenUsage, accounts]);
  const orderedAccounts = useMemo(() => [...accounts].sort(
    (left, right) => Number(needsAccountAttention(left, hotSwitchEnabled, showUsageNetworkErrors))
      - Number(needsAccountAttention(right, hotSwitchEnabled, showUsageNetworkErrors)),
  ), [accounts, hotSwitchEnabled, showUsageNetworkErrors]);
  const selectedAccountIdSet = new Set(selectedAccountIds);
  const consumableSelectedAccountIds = accounts
    .filter((account) => selectedAccountIdSet.has(account.id) && account.autoSwitchEnabled)
    .map((account) => account.id);
  const deletableSelectedAccountIds = accounts
    .filter((account) => selectedAccountIdSet.has(account.id) && !account.active)
    .map((account) => account.id);
  const enableableSelectedAccountIds = accounts
    .filter((account) => selectedAccountIdSet.has(account.id) && !account.autoSwitchEnabled)
    .map((account) => account.id);
  const disableableSelectedAccountIds = accounts
    .filter((account) => selectedAccountIdSet.has(account.id) && account.autoSwitchEnabled)
    .map((account) => account.id);
  const activeAccount = accounts.find((account) => account.active) ?? null;
  const officialAuthAccount = accounts.find((account) => account.id === openaiAuthAccountId) ?? null;
  const accountSummaryLabel = (account: Account | null) => {
    if (!account) return "-";
    return privacyMode ? maskAccountEmail(account.email) : account.email;
  };
  const handleTableChange: NonNullable<TableProps<Account>["onChange"]> = (_, __, sorter) => {
    const activeSorter = Array.isArray(sorter) ? sorter[0] : sorter;
    const nextSort = isUsageSortColumn(activeSorter.columnKey) && isUsageSortOrder(activeSorter.order)
      ? { column: activeSorter.columnKey, order: activeSorter.order }
      : null;

    setUsageSort(nextSort);
    persistUsageSortPreference(nextSort);
  };

  const columns: ColumnsType<Account> = [
    Table.EXPAND_COLUMN as ColumnsType<Account>[number],
    {
      title: t("table.account"), key: "account", dataIndex: "email", width: 280, fixed: "left",
      sorter: (left, right, sortOrder) => compareKeepingAttentionLast(
        left,
        right,
        hotSwitchEnabled,
        showUsageNetworkErrors,
        sortOrder,
        (first, second) => first.email.localeCompare(second.email),
      ),
      filters: [
        { text: t("table.filterNormal"), value: "normal" },
        { text: t("table.filterError"), value: "error" },
      ],
      onFilter: (value, account) => value === "error"
        ? needsAccountAttention(account, hotSwitchEnabled, showUsageNetworkErrors)
        : !needsAccountAttention(account, hotSwitchEnabled, showUsageNetworkErrors),
      render: (_, account) => (
        <div className="account-cell">
          <div className="table-avatar-wrap">
            <div className={`table-avatar${isAccountDisabled(account, hotSwitchEnabled) ? " disabled-avatar" : ""}`}>
              {isAccountDisabled(account, hotSwitchEnabled) ? t("table.disabled") : initials(account.email)}
            </div>
            {concurrentRoutingActive && account.autoSwitchEnabled
              && (accountConversationCounts[account.id] ?? 0) > 0 && (
              <span className="account-conversation-count"
                title={t("table.conversationCount", { count: accountConversationCounts[account.id] })}
                aria-label={t("table.conversationCount", { count: accountConversationCounts[account.id] })}>
                {accountConversationCounts[account.id] > 99 ? "99+" : accountConversationCounts[account.id]}
              </span>
            )}
          </div>
          <div className="account-primary">
            <div className="account-email-row">
              <CopyableAccountEmail email={account.email}
                displayEmail={privacyMode ? maskAccountEmail(account.email) : account.email} t={t} />
              <AccountResetCreditCount count={resetCreditsCount(resetCredits[account.id])} language={language} />
            </div>
            <AccountNoteEditButton account={account} hideAccountNotes={hideAccountNotes}
              onEdit={() => openAccountDetails(account)} t={t} />
            <div className="account-meta">
              <Tooltip title={account.accountId ? t("table.workspace", { id: account.accountId }) : t("table.personal")}>
                <Tag className="plan-tag">{account.plan || "ChatGPT"}</Tag>
              </Tooltip>
              {account.official && <Tag className="official-account-tag">{t("table.official")}</Tag>}
              <div className="updated-cell">
                {accountExpirationDate(account.expiresAt, account.usage.apiExpiresAt) && (
                  <span className="plan-expiration">{t("table.expiresAt", {
                    date: accountExpirationDate(account.expiresAt, account.usage.apiExpiresAt) ?? "",
                  })}</span>
                )}
                {shouldShowUsageError(account.usage.error, showUsageNetworkErrors)
                  && <Tooltip title={account.usage.error}><Tag color="error">{t("table.error")}</Tag></Tooltip>}
              </div>
            </div>
          </div>
        </div>
      ),
    },
    {
      title: t("table.fiveHours"), key: "fiveHours", width: 260,
      sorter: (left, right, sortOrder) => compareKeepingAttentionLast(
        left,
        right,
        hotSwitchEnabled,
        showUsageNetworkErrors,
        sortOrder,
        (first, second) => compareUsageRemaining(first, second, "primary"),
      ),
      sortOrder: usageSort?.column === "fiveHours" ? usageSort.order : null,
      // OpenAI currently reports the primary (5-hour) quota with a weekly reset window.
      // Render its reset time like the weekly quota so it does not show a misleading 5-hour countdown.
      render: (_, account) => <UsageMeter window={account.usage.primary} resetWindow="oneWeek"
        fetchedAt={account.usage.fetchedAt} language={language} t={t} />,
    },
    {
      title: t("table.oneWeek"), key: "oneWeek", width: 260,
      sorter: (left, right, sortOrder) => compareKeepingAttentionLast(
        left,
        right,
        hotSwitchEnabled,
        showUsageNetworkErrors,
        sortOrder,
        (first, second) => compareUsageRemaining(first, second, "secondary"),
      ),
      sortOrder: usageSort?.column === "oneWeek" ? usageSort.order : null,
      render: (_, account) => <UsageMeter window={account.usage.secondary} resetWindow="oneWeek"
        language={language} t={t} />,
    },
    {
      title: t("table.tokenTotals"), key: "tokenTotals", width: 92, align: "center" as const,
      render: (_: unknown, account: Account) => (
        <div className="account-token-chart-cell">
          {hotSwitchEnabled ? (
            <CompactDailyTokenChart
              totals={totalsForAccount(todayTokenTotalsByAccount, account)}
              language={language} />
          ) : (
            <Tooltip title={t("table.tokenTotalsProxyOnly")}>
              <span className="account-token-chart-unavailable">--</span>
            </Tooltip>
          )}
        </div>
      ),
    },
    ...(customPriorityActive ? [{
      title: t("table.autoSwitchPriority"), key: "autoSwitchPriority", width: 150,
      align: "center" as const, fixed: "right" as const,
      render: (_: unknown, account: Account) => (
        <AutoSwitchPriorityInput account={account} t={t}
          disabled={autoSwitchPriorityBusyAccountId !== null}
          onSave={onAutoSwitchPriorityChange} />
      ),
    }] : []),
    {
      title: t("table.actions"), key: "actions", width: 300, align: "center", fixed: "right",
      render: (_, account) => {
        const waiting = busyAccountId === account.id;
        const resetWaiting = resetCreditBusyAccountId === account.id;
        const officialAuthActive = openaiAuthAccountId === account.id;
        const officialAuthUnsupported = Boolean(account.agentIdentity) && !officialAuthActive;
        const switchBlocked = hotSwitchEnabled
          ? !account.localProxyCompatible
          : !account.directSwitchCompatible;
        const switchBlockedReason = hotSwitchEnabled
          ? t("providers.proxy.agentIdentityUnsupported")
          : t("providers.proxy.agentIdentityProxyOnly");
        return (
          <Space size={4} className="table-actions">
            {!concurrentRoutingActive && (
              <Tooltip title={!account.active && switchBlocked ? switchBlockedReason : undefined}>
                <span>
                  {account.active ? (
                    <Popconfirm title={t("table.deactivateConfirmTitle")}
                      description={<span>{t("table.deactivateConfirmDescription")}</span>}
                      okText={t("table.deactivate")} cancelText={t("table.cancel")}
                      okButtonProps={{ danger: true }}
                      styles={{ root: { maxWidth: 400 } }}
                      onConfirm={() => onDeactivate(account.id)}>
                      <Button danger size="small" loading={waiting} icon={<X size={14} />}>
                        {t("table.deactivate")}
                      </Button>
                    </Popconfirm>
                  ) : (
                    <Button size="small" type="primary" disabled={switchBlocked}
                      loading={waiting} icon={<RotateCcw size={14} />}
                      onClick={() => onSwitch(account.id)}>
                      {t("table.switch")}
                    </Button>
                  )}
                </span>
              </Tooltip>
            )}
            {hotSwitchEnabled && (
              <Tooltip placement="top" classNames={{ root: "openai-auth-action-tooltip" }} title={(
                <div className="openai-auth-action-tooltip-content">
                  <p>{t("providers.proxy.openaiAuthAccountTooltipRemote")}</p>
                  <p>{t("providers.proxy.openaiAuthAccountTooltipCapabilities")}</p>
                  {officialAuthUnsupported && (
                    <p className="warning">{t("providers.error.openaiAuthAccountOAuthRequired")}</p>
                  )}
                </div>
              )}>
                <span>
                  <Button size="small" type={officialAuthActive ? "primary" : "default"}
                    danger={officialAuthActive}
                    loading={openaiAuthBusy && openaiAuthPendingAccountId === account.id}
                    disabled={openaiAuthBusy || officialAuthUnsupported}
                    onClick={() => {
                      setOpenaiAuthPendingAccountId(account.id);
                      onOpenaiAuthAccountChange(officialAuthActive ? null : account.id);
                    }}>
                    {t(officialAuthActive
                      ? "providers.proxy.deactivateOpenaiAuthAccount"
                      : "providers.proxy.activateOpenaiAuthAccount")}
                  </Button>
                </span>
              </Tooltip>
            )}
            <Dropdown trigger={["click"]} placement="bottomRight"
              open={tableActionMenuAccountId === account.id}
              onOpenChange={(open) => setTableActionMenuAccountId(open ? account.id : null)}
              dropdownRender={() => (
                <div className="account-action-menu" onClick={(event) => event.stopPropagation()}>
                  <Popconfirm title={t("table.useResetCreditConfirmTitle")}
                    description={<span className="reset-credit-confirm-description">{t("table.useResetCreditConfirmDescription")}</span>}
                    okText={t("table.useResetCreditOk")} cancelText={t("table.cancel")}
                    classNames={{ root: "reset-credit-popconfirm" }}
                    styles={{ root: { width: 320, maxWidth: "calc(100vw - 32px)" } }}
                    disabled={waiting || resetWaiting}
                    onConfirm={() => {
                      setTableActionMenuAccountId(null);
                      onUseResetCredit(account.id);
                    }}>
                    <button type="button" disabled={waiting || resetWaiting}>
                      <CalendarClock size={14} />
                      {resetWaiting ? t("table.resetCreditsRefreshing") : t("table.useResetCredit")}
                    </button>
                  </Popconfirm>
                  <button type="button" disabled={waiting} onClick={() => {
                    setTableActionMenuAccountId(null);
                    onRefresh(account.id);
                  }}>
                    <RefreshCw size={14} />
                    {t("table.refreshUsage")}
                  </button>
                  <button type="button" onClick={() => {
                    setTableActionMenuAccountId(null);
                    onCopyAuthJson(account.id);
                  }}>
                    <Copy size={14} />
                    {t("table.copyAuthJson")}
                  </button>
                  {hotSwitchEnabled && (
                    <Tooltip title={t("table.autoSwitchTooltip")} placement="left">
                      <button type="button"
                        disabled={autoSwitchBusyAccountId !== null || bulkEnableBusy || bulkDisableBusy}
                        onClick={() => {
                          setTableActionMenuAccountId(null);
                          onAutoSwitchEnabledChange(account.id, !account.autoSwitchEnabled);
                        }}>
                        {account.autoSwitchEnabled ? <ToggleLeft size={14} /> : <ToggleRight size={14} />}
                        {account.autoSwitchEnabled ? t("table.disableAutoSwitch") : t("table.enableAutoSwitch")}
                      </button>
                    </Tooltip>
                  )}
                  <div className="account-action-menu-divider" />
                  <Popconfirm title={t("table.deleteConfirmTitle")} description={t("table.deleteConfirmDescription")}
                    okText={t("table.delete")} cancelText={t("table.cancel")} okButtonProps={{ danger: true }}
                    disabled={account.active}
                    onConfirm={() => {
                      setTableActionMenuAccountId(null);
                      onDelete(account.id);
                    }}>
                    <button type="button" className="destructive" disabled={account.active}
                      title={account.active ? t("table.activeDeleteTooltip") : undefined}>
                      <Trash2 size={14} />
                      {t("table.delete")}
                    </button>
                  </Popconfirm>
                </div>
              )}>
              <Tooltip title={t("table.moreActions")}>
                <Button size="small" className="table-icon-button" aria-label={t("table.moreActions")}
                  icon={<MoreHorizontal size={16} />} />
              </Tooltip>
            </Dropdown>
          </Space>
        );
      },
    },
  ];
  const hiddenColumnSet = new Set(hiddenColumns);
  const visibleColumns = columns.filter((column) =>
    !isAccountTableColumnKey(column.key) || !hiddenColumnSet.has(column.key));
  const columnSettings: { key: AccountTableColumnKey; label: string }[] = [
    { key: "account", label: t("table.account") },
    { key: "fiveHours", label: t("table.fiveHours") },
    { key: "oneWeek", label: t("table.oneWeek") },
    { key: "tokenTotals", label: t("table.tokenTotals") },
    ...(customPriorityActive
      ? [{ key: "autoSwitchPriority" as const, label: t("table.autoSwitchPriority") }]
      : []),
    { key: "actions", label: t("table.actions") },
  ];
  const visibleConfigurableColumnCount = columnSettings
    .filter(({ key }) => !hiddenColumnSet.has(key)).length;
  const tableScrollX = 68 + visibleColumns.reduce(
    (total, column) => total + (typeof column.width === "number" ? column.width : 0),
    0,
  );
  const setColumnVisible = (key: AccountTableColumnKey, visible: boolean) => {
    setHiddenColumns((current) => {
      if (!visible && !current.includes(key) && visibleConfigurableColumnCount <= 1) return current;
      const next = visible
        ? current.filter((column) => column !== key)
        : [...new Set([...current, key])];
      persistHiddenColumns(next);
      return next;
    });
  };

  const tableContextAccount = contextMenu
    ? accounts.find((account) => account.id === contextMenu.accountId) ?? null
    : null;
  const tableContextMenu = tableContextAccount && contextMenu ? (() => {
    const account = tableContextAccount;
    const waiting = busyAccountId === account.id;
    const resetWaiting = resetCreditBusyAccountId === account.id;
    const switchBlocked = hotSwitchEnabled
      ? !account.localProxyCompatible
      : !account.directSwitchCompatible;
    const switchBlockedReason = hotSwitchEnabled
      ? t("providers.proxy.agentIdentityUnsupported")
      : t("providers.proxy.agentIdentityProxyOnly");
    const officialAuthActive = openaiAuthAccountId === account.id;
    const officialAuthUnsupported = Boolean(account.agentIdentity) && !officialAuthActive;

    return (
      <div ref={contextMenuRef} className="context-menu account-row-context-menu"
        style={{ left: contextMenu.x, top: contextMenu.y }}
        onClick={(event) => event.stopPropagation()}>
        {!concurrentRoutingActive && (
          <Tooltip title={!account.active && switchBlocked ? switchBlockedReason : undefined} placement="left">
            {account.active ? (
              <Popconfirm title={t("table.deactivateConfirmTitle")}
                description={<span>{t("table.deactivateConfirmDescription")}</span>}
                okText={t("table.deactivate")} cancelText={t("table.cancel")}
                okButtonProps={{ danger: true }} styles={{ root: { maxWidth: 400 } }}
                onConfirm={() => {
                  setContextMenu(null);
                  onDeactivate(account.id);
                }}>
                <button type="button" className="destructive" disabled={waiting}>
                  <X size={14} />
                  {t("table.deactivate")}
                </button>
              </Popconfirm>
            ) : (
              <button type="button" disabled={switchBlocked || waiting}
                onClick={() => {
                  setContextMenu(null);
                  onSwitch(account.id);
                }}>
                <RotateCcw size={14} />
                {t("table.switch")}
              </button>
            )}
          </Tooltip>
        )}
        {hotSwitchEnabled && (
          <Tooltip placement="left" classNames={{ root: "openai-auth-action-tooltip" }} title={(
            <div className="openai-auth-action-tooltip-content">
              <p>{t("providers.proxy.openaiAuthAccountTooltipRemote")}</p>
              <p>{t("providers.proxy.openaiAuthAccountTooltipCapabilities")}</p>
              {officialAuthUnsupported && (
                <p className="warning">{t("providers.error.openaiAuthAccountOAuthRequired")}</p>
              )}
            </div>
          )}>
            <button type="button" className={officialAuthActive ? "destructive" : undefined}
              disabled={openaiAuthBusy || officialAuthUnsupported}
              onClick={() => {
                setContextMenu(null);
                setOpenaiAuthPendingAccountId(account.id);
                onOpenaiAuthAccountChange(officialAuthActive ? null : account.id);
              }}>
              {officialAuthActive ? <LogOut size={14} /> : <LogIn size={14} />}
              {t(officialAuthActive
                ? "providers.proxy.deactivateOpenaiAuthAccount"
                : "providers.proxy.activateOpenaiAuthAccount")}
            </button>
          </Tooltip>
        )}
        {hotSwitchEnabled && (
          <Tooltip title={t("table.autoSwitchTooltip")} placement="left">
            <button type="button"
              disabled={autoSwitchBusyAccountId !== null || bulkEnableBusy || bulkDisableBusy}
              onClick={() => {
                setContextMenu(null);
                onAutoSwitchEnabledChange(account.id, !account.autoSwitchEnabled);
              }}>
              {account.autoSwitchEnabled ? <ToggleLeft size={14} /> : <ToggleRight size={14} />}
              {account.autoSwitchEnabled ? t("table.disableAutoSwitch") : t("table.enableAutoSwitch")}
            </button>
          </Tooltip>
        )}
        <div className="context-menu-divider" />
        <Popconfirm title={t("table.useResetCreditConfirmTitle")}
          description={<span className="reset-credit-confirm-description">{t("table.useResetCreditConfirmDescription")}</span>}
          okText={t("table.useResetCreditOk")} cancelText={t("table.cancel")}
          classNames={{ root: "reset-credit-popconfirm" }}
          styles={{ root: { width: 320, maxWidth: "calc(100vw - 32px)" } }}
          disabled={waiting || resetWaiting}
          onConfirm={() => {
            setContextMenu(null);
            onUseResetCredit(account.id);
          }}>
          <button type="button" disabled={waiting || resetWaiting}>
            <CalendarClock size={14} />
            {resetWaiting ? t("table.resetCreditsRefreshing") : t("table.useResetCredit")}
          </button>
        </Popconfirm>
        <button type="button" onClick={() => {
          setContextMenu(null);
          setResetCreditsAccount(account);
          onLoadResetCredits(account.id);
        }}>
          <CalendarClock size={14} />
          {t("table.viewResetCredits")}
        </button>
        <button type="button" disabled={waiting} onClick={() => {
          setContextMenu(null);
          onRefresh(account.id);
        }}>
          <RefreshCw size={14} />
          {t("table.refreshUsage")}
        </button>
        <button type="button" onClick={() => {
          setContextMenu(null);
          onCopyAuthJson(account.id);
        }}>
          <Copy size={14} />
          {t("table.copyAuthJson")}
        </button>
        <button type="button" disabled={!canEditAccountMetadata(account)}
          title={!canEditAccountMetadata(account) ? t("table.officialMetadataReadOnly") : undefined}
          onClick={() => {
          setContextMenu(null);
          openAccountDetails(account);
        }}>
          <Pencil size={14} />
          {t("table.editNoteAndExpiry")}
        </button>
        <div className="context-menu-divider" />
        <Popconfirm title={t("table.deleteConfirmTitle")} description={t("table.deleteConfirmDescription")}
          okText={t("table.delete")} cancelText={t("table.cancel")} okButtonProps={{ danger: true }}
          disabled={account.active}
          onConfirm={() => {
            setContextMenu(null);
            onDelete(account.id);
          }}>
          <button type="button" className="destructive" disabled={account.active}
            title={account.active ? t("table.activeDeleteTooltip") : undefined}>
            <Trash2 size={14} />
            {t("table.delete")}
          </button>
        </Popconfirm>
      </div>
    );
  })() : null;

  const accountToolbarSummary = (
    <div className="account-table-toolbar-summary">
      <span>
        {t("table.currentAccountLabel")}{language === "zh" ? "：" : ": "}
        <strong title={privacyMode ? undefined : activeAccount?.email}>
          {accountSummaryLabel(activeAccount)}
        </strong>
      </span>
      <span>
        {t("table.officialAuthAccountLabel")}{language === "zh" ? "：" : ": "}
        <strong title={privacyMode ? undefined : officialAuthAccount?.email}>
          {accountSummaryLabel(officialAuthAccount)}
        </strong>
      </span>
      <Tooltip title={t(modelContextWindowTooltipKey(modelContextWindow.error))}
        styles={{ root: { maxWidth: 400 } }}>
        <span className="model-context-window-control">
          <span>{t("table.modelContextWindow")}{language === "zh" ? "：" : ": "}</span>
          <AutoComplete value={modelContextWindow.valueK}
            options={GPT_5_6_SOL_CONTEXT_WINDOW_OPTIONS}
            placeholder={DEFAULT_GPT_5_6_SOL_CONTEXT_WINDOW_K}
            aria-label={t("table.modelContextWindow")}
            disabled={modelContextWindow.saving}
            status={modelContextWindow.error ? "error" : undefined}
            onChange={modelContextWindow.updateValueK}
            onBlur={() => void modelContextWindow.saveValueK(modelContextWindow.valueK)} />
          <span>K</span>
        </span>
      </Tooltip>
      {proxyControls}
    </div>
  );
  const concurrentRoutingControl = (
    <Tooltip title={t("table.concurrentRoutingTooltip")} styles={{ root: { maxWidth: 400 } }}>
      <span className="account-concurrent-routing-control">
        <span>{t("table.concurrentRouting")}</span>
        <Switch size="small" checked={concurrentAccountRoutingEnabled}
          loading={concurrentAccountRoutingBusy}
          disabled={!hotSwitchEnabled || concurrentAccountRoutingBusy}
          aria-label={t("table.concurrentRouting")}
          onChange={onConcurrentAccountRoutingChange} />
      </span>
    </Tooltip>
  );
  const batchConsumeControl = (
    <Popconfirm title={t("table.batchConsumeQuotaConfirmTitle", {
      count: consumableSelectedAccountIds.length,
    })} okText={t("table.batchConsumeQuotaOk")} cancelText={t("table.cancel")}
      onOpenChange={setBulkConsumeQuotaConfirmOpen}
      disabled={!consumableSelectedAccountIds.length || bulkConsumeQuotaBusy
        || bulkDeleteBusy || bulkEnableBusy || bulkDisableBusy
        || autoSwitchBusyAccountId !== null}
      onConfirm={async () => {
        const ids = [...consumableSelectedAccountIds];
        setBulkConsumeQuotaBusy(true);
        try {
          await onConsumeQuotaMany(ids);
        } finally {
          setBulkConsumeQuotaBusy(false);
        }
      }}>
      <Tooltip title={bulkConsumeQuotaConfirmOpen ? null : t("table.batchConsumeQuotaTooltip")}>
        <Button size="small" icon={<Gauge size={14} />} loading={bulkConsumeQuotaBusy}
          disabled={!consumableSelectedAccountIds.length || bulkDeleteBusy
            || bulkEnableBusy || bulkDisableBusy || autoSwitchBusyAccountId !== null}>
          {t("table.batchConsumeQuota")}
        </Button>
      </Tooltip>
    </Popconfirm>
  );

  if (displayMode === "cards") return <>
    {cardTopbarHost && createPortal(
      <div className="account-card-heading-controls">
        {accountToolbarSummary}
        {concurrentRoutingControl}
        {batchConsumeControl}
      </div>,
      cardTopbarHost,
    )}
    <div className="account-card-grid">
      {orderedAccounts.map((account) => {
        const waiting = busyAccountId === account.id;
        const isDisabled = isAccountDisabled(account, hotSwitchEnabled);
        const switchBlocked = hotSwitchEnabled
          ? !account.localProxyCompatible
          : !account.directSwitchCompatible;
        const switchBlockedReason = hotSwitchEnabled
          ? t("providers.proxy.agentIdentityUnsupported")
          : t("providers.proxy.agentIdentityProxyOnly");
        return (
          <article key={account.id} className={`account-card${isAccountHighlighted(account, concurrentRoutingActive) ? " active" : ""}${isDisabled ? " account-alert-card" : ""}`}
            title={switchBlocked ? switchBlockedReason : undefined}
            aria-disabled={switchBlocked}
            onClick={(event) => {
              if ((event.target as HTMLElement).closest("button, a, input, textarea, summary, details")) return;
              setContextMenu(null);
              if (!concurrentRoutingActive && !account.active && !switchBlocked) onSwitch(account.id);
            }}
            onContextMenu={(event) => {
              event.preventDefault();
              setContextMenu({
                accountId: account.id,
                ...contextMenuPosition(event, hotSwitchEnabled
                  ? ACCOUNT_CONTEXT_MENU_HEIGHT.hotSwitch
                  : ACCOUNT_CONTEXT_MENU_HEIGHT.directSwitch),
              });
            }}>
            <div className="card-topline" />
            <header className="account-head">
              <div className={`avatar${isDisabled ? " disabled-avatar" : ""}`}>
                {isDisabled ? t("table.disabled") : initials(account.email)}
              </div>
              <div className="identity">
                <div className="identity-line">
                  <CopyableAccountEmail email={account.email}
                    displayEmail={privacyMode ? maskAccountEmail(account.email) : account.email} t={t} />
                  <AccountResetCreditCount count={resetCreditsCount(resetCredits[account.id])}
                    language={language} />
                  <Tooltip title={account.accountId ? t("table.workspace", { id: account.accountId }) : t("table.personal")}>
                    <Tag className="plan-tag">{account.plan || "ChatGPT"}</Tag>
                  </Tooltip>
                  {account.official && <Tag className="official-account-tag">{t("table.official")}</Tag>}
                </div>
                <AccountNoteEditButton account={account} hideAccountNotes={hideAccountNotes}
                  onEdit={() => openAccountDetails(account)} t={t} />
                <div className="plan-line">
                  {accountExpirationDate(account.expiresAt, account.usage.apiExpiresAt) && (
                    <span>{t("table.expiresAt", {
                      date: accountExpirationDate(account.expiresAt, account.usage.apiExpiresAt) ?? "",
                    })}</span>
                  )}
                  {shouldShowUsageError(account.usage.error, showUsageNetworkErrors)
                    && <Tooltip title={account.usage.error}><Tag color="error">{t("table.error")}</Tag></Tooltip>}
                </div>
              </div>
              <div className="card-header-actions">
                <Tooltip title={t("table.refreshUsage")}><Button size="small" className="table-icon-button" loading={waiting}
                  icon={<RefreshCw size={14} />} onClick={() => onRefresh(account.id)} /></Tooltip>
                <UsageRefreshAge fetchedAt={account.usage.fetchedAt} t={t} />
              </div>
            </header>
            <div className="account-card-usage">
              <section>
                <UsageMeter window={account.usage.primary} resetWindow="oneWeek"
                  fetchedAt={account.usage.fetchedAt} variant="card"
                  cardLabel={t("usage.primaryMarker")} cardLabelSuffix={t("usage.unit")}
                  language={language} t={t} />
              </section>
              <section>
                <UsageMeter window={account.usage.secondary} resetWindow="oneWeek"
                  variant="card" cardLabel={t("usage.secondaryMarker")} cardLabelSuffix={t("usage.unit")}
                  language={language} t={t} />
              </section>
            </div>
          </article>
        );
      })}
    </div>
    {tableContextMenu}
    {editingAccount && <AccountNoteModal key={editingAccount.id} account={editingAccount}
      loading={loadingAccountDetailsId === editingAccount.id}
      onClose={() => setEditingAccount(null)}
      onSave={(details) => onSaveNote(editingAccount.id, details)} t={t} />}
    {resetCreditsAccount && <ResetCreditsModal state={resetCredits[resetCreditsAccount.id]} onClose={() => setResetCreditsAccount(null)}
      onRetry={() => onLoadResetCredits(resetCreditsAccount.id, true)} language={language} t={t} />}
  </>;

  return <>
    <div ref={tableWrapRef} className="account-table-wrap">
      <div className="account-table-toolbar">
        {accountToolbarSummary}
        {concurrentRoutingControl}
        {batchConsumeControl}
        <Popconfirm title={t("table.batchDeleteConfirmTitle", { count: deletableSelectedAccountIds.length })}
          description={t("table.batchDeleteConfirmDescription")}
          okText={t("table.delete")} cancelText={t("table.cancel")} okButtonProps={{ danger: true }}
          disabled={!deletableSelectedAccountIds.length || bulkConsumeQuotaBusy
            || bulkDeleteBusy || bulkEnableBusy || bulkDisableBusy}
          onConfirm={async () => {
            const ids = [...deletableSelectedAccountIds];
            setBulkDeleteBusy(true);
            try {
              const deletedIds = await onDeleteMany(ids);
              const deletedIdSet = new Set(deletedIds);
              setSelectedAccountIds((current) => current.filter((id) => !deletedIdSet.has(id)));
            } finally {
              setBulkDeleteBusy(false);
            }
          }}>
          <Button danger size="small" icon={<Trash2 size={14} />} loading={bulkDeleteBusy}
            disabled={!deletableSelectedAccountIds.length || bulkConsumeQuotaBusy
              || bulkEnableBusy || bulkDisableBusy}>
            {t("table.batchDelete", { count: deletableSelectedAccountIds.length })}
          </Button>
        </Popconfirm>
        {hotSwitchEnabled && (
          <Button type="primary" size="small" icon={<ToggleRight size={14} />} loading={bulkEnableBusy}
            disabled={!enableableSelectedAccountIds.length || bulkConsumeQuotaBusy
              || bulkDeleteBusy || bulkDisableBusy
              || autoSwitchBusyAccountId !== null}
            onClick={async () => {
              const ids = [...enableableSelectedAccountIds];
              setBulkEnableBusy(true);
              try {
                await onEnableMany(ids);
              } finally {
                setBulkEnableBusy(false);
              }
            }}>
            {t("table.batchEnable", { count: enableableSelectedAccountIds.length })}
          </Button>
        )}
        {hotSwitchEnabled && (
          <Button size="small" icon={<ToggleLeft size={14} />} loading={bulkDisableBusy}
            disabled={!disableableSelectedAccountIds.length || bulkConsumeQuotaBusy
              || bulkDeleteBusy || bulkEnableBusy
              || autoSwitchBusyAccountId !== null}
            onClick={async () => {
              const ids = [...disableableSelectedAccountIds];
              setBulkDisableBusy(true);
              try {
                await onDisableMany(ids);
              } finally {
                setBulkDisableBusy(false);
              }
            }}>
            {t("table.batchDisable", { count: disableableSelectedAccountIds.length })}
          </Button>
        )}
        <Dropdown trigger={["click"]} placement="bottomRight"
          dropdownRender={() => (
            <div className="account-column-settings" onClick={(event) => event.stopPropagation()}>
              <strong>{t("table.columnSettings")}</strong>
              <div className="account-column-settings-list">
                {columnSettings.map(({ key, label }) => {
                  const checked = !hiddenColumnSet.has(key);
                  return (
                    <Checkbox key={key} checked={checked}
                      disabled={checked && visibleConfigurableColumnCount <= 1}
                      onChange={(event) => setColumnVisible(key, event.target.checked)}>
                      {label}
                    </Checkbox>
                  );
                })}
              </div>
            </div>
          )}>
          <Tooltip title={t("table.columnSettings")}>
            <Button size="small" className="table-icon-button"
              aria-label={t("table.columnSettings")} icon={<Columns3 size={15} />} />
          </Tooltip>
        </Dropdown>
      </div>
      <Table rowKey="id" size="small" tableLayout="fixed" columns={visibleColumns} dataSource={orderedAccounts} pagination={false}
        onChange={handleTableChange}
        rowSelection={{
          fixed: true,
          columnWidth: 36,
          selectedRowKeys: selectedAccountIds,
          onChange: (keys) => setSelectedAccountIds(keys.map(String)),
        }}
        rowClassName={(account) => [
          isAccountHighlighted(account, concurrentRoutingActive) ? "active-row" : "",
          isAccountDisabled(account, hotSwitchEnabled) ? "account-alert-row" : "",
        ].filter(Boolean).join(" ")}
        onRow={(account) => ({
          onContextMenu: (event) => {
            event.preventDefault();
            setTableActionMenuAccountId(null);
            setContextMenu({
              accountId: account.id,
              ...contextMenuPosition(event, hotSwitchEnabled
                ? ACCOUNT_CONTEXT_MENU_HEIGHT.hotSwitch
                : ACCOUNT_CONTEXT_MENU_HEIGHT.directSwitch),
            });
          },
        })}
        expandable={{
          columnWidth: 32,
          fixed: "left",
          expandedRowRender: (account) => <ResetCreditsPanel state={resetCredits[account.id]}
            onRetry={() => onLoadResetCredits(account.id, true)} language={language} t={t} />,
          onExpand: (expanded, account) => { if (expanded) onLoadResetCredits(account.id); },
        }}
        scroll={tableScrollY ? { x: tableScrollX, y: tableScrollY } : { x: tableScrollX }} />
    </div>
    {tableContextMenu}
    {editingAccount && <AccountNoteModal key={editingAccount.id} account={editingAccount}
      loading={loadingAccountDetailsId === editingAccount.id}
      onClose={() => setEditingAccount(null)}
      onSave={(details) => onSaveNote(editingAccount.id, details)} t={t} />}
    {resetCreditsAccount && <ResetCreditsModal state={resetCredits[resetCreditsAccount.id]} onClose={() => setResetCreditsAccount(null)}
      onRetry={() => onLoadResetCredits(resetCreditsAccount.id, true)} language={language} t={t} />}
  </>;
}
