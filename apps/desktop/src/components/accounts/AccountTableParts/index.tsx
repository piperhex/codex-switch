import { useEffect, useRef, useState } from "react";
import { Button, InputNumber, Popover, Tooltip } from "antd";
import { CalendarClock, Check, Copy, Pencil, Settings, X } from "lucide-react";
import type { Language, Translate } from "../../../i18n";
import type {
  Account,
  AccountTokenUsageTotals,
  ResetCreditsLoadState,
} from "../../../types";
import { formatCompactTokenCount } from "../../../utils/tokenContext";
import { shouldShowUsageError } from "../../../utils/usageErrors";
import {
  DailyTokenUsageTooltip,
  EMPTY_TOKEN_TOTALS,
  type TokenTypeTotals,
} from "../../DailyTokenUsageTooltip";
import { ResetCreditsPanel } from "../ResetCreditsPanel";
import styles from "./index.module.less";

const EMAIL_COPY_FEEDBACK_DURATION_MS = 1_600;

export function resetCreditsCount(state?: ResetCreditsLoadState) {
  return state?.status === "loaded" ? state.data.credits.length : null;
}

export function AccountResetCreditCount({ count, language }: { count: number | null; language: Language }) {
  if (!count) return null;
  const label = language === "zh" ? `${count}重置卡` : `${count} reset card${count === 1 ? "" : "s"}`;
  return <span className="account-reset-credit-count"><span aria-hidden="true">·</span>{label}</span>;
}

export function CopyableAccountEmail({ email, displayEmail, t }: {
  email: string;
  displayEmail: string;
  t: Translate;
}) {
  const [copied, setCopied] = useState(false);
  const resetTimer = useRef<number | null>(null);
  useEffect(() => () => {
    if (resetTimer.current !== null) window.clearTimeout(resetTimer.current);
  }, []);

  const copyEmail = async () => {
    try {
      await navigator.clipboard.writeText(email);
      setCopied(true);
      if (resetTimer.current !== null) window.clearTimeout(resetTimer.current);
      resetTimer.current = window.setTimeout(() => setCopied(false), EMAIL_COPY_FEEDBACK_DURATION_MS);
    } catch {
      setCopied(false);
    }
  };

  const label = copied ? t("totp.copied") : t("table.copyEmail");
  return (
    <Tooltip title={label}>
      <button type="button" className={`account-email-copy${copied ? " copied" : ""}`}
        aria-label={label} onClick={(event) => {
          event.stopPropagation();
          void copyEmail();
        }}>
        {copied ? <Check size={12} aria-hidden="true" /> : <Copy size={12} aria-hidden="true" />}
        <span className="account-email">{displayEmail}</span>
      </button>
    </Tooltip>
  );
}

export function tokenUsageMatchesAccount(usage: AccountTokenUsageTotals, account: Account) {
  const accountId = account.accountId?.trim();
  const usageAccountId = usage.accountId?.trim();
  if (accountId && usageAccountId && accountId === usageAccountId) return true;
  const email = account.email.trim().toLowerCase();
  const usageEmail = usage.accountEmail?.trim().toLowerCase();
  return Boolean(email && usageEmail && email === usageEmail);
}

export function CompactDailyTokenChart({ totals, language }: {
  totals: TokenTypeTotals;
  language: Language;
}) {
  const values = [totals.input, totals.output, totals.reasoning, totals.cached];
  const maximum = Math.max(...values, 1);
  const title = language === "zh" ? "今日 Token 用量" : "Today's Token usage";
  return (
    <Tooltip title={<DailyTokenUsageTooltip totals={totals} language={language} />} placement="top">
      <div className={`compact-model-token-chart ${styles.compactModelTokenChart}`} role="img"
        aria-label={`${title}: ${formatCompactTokenCount(totals.total, language)}`}>
        <span>{language === "zh" ? "今日" : "TODAY"}</span>
        <svg viewBox="0 0 48 26" aria-hidden="true">
          {values.map((value, index) => {
            const height = value > 0 ? Math.max(3, Math.round((value / maximum) * 22)) : 2;
            return <rect key={index} className={`token-type-${index}`} x={index * 12 + 2}
              y={24 - height} width="8" height={height} rx="2" />;
          })}
        </svg>
        <small>{formatCompactTokenCount(totals.total, language)}</small>
      </div>
    </Tooltip>
  );
}

export function totalsForAccount(totalsByAccount: Map<string, TokenTypeTotals>, account: Account) {
  return totalsByAccount.get(account.id) ?? EMPTY_TOKEN_TOTALS;
}

export function canEditAccountMetadata(account: Account) {
  return !account.official || account.metadataEditable;
}

export function AccountNoteEditButton({ account, hideAccountNotes, onEdit, t }: {
  account: Account;
  hideAccountNotes: boolean;
  onEdit: () => void;
  t: Translate;
}) {
  const noteText = hideAccountNotes && account.note ? "**********" : account.note || t("table.noNote");
  const editable = canEditAccountMetadata(account);

  return <button type="button" className={`account-note-edit${account.note ? "" : " empty"}`}
    disabled={!editable} title={editable ? noteText : t("table.officialMetadataReadOnly")} onClick={onEdit}>
    <Pencil size={11} aria-hidden="true" />
    <span>{noteText}</span>
  </button>;
}

export function AutoSwitchPriorityInput({ account, disabled, onSave, t }: {
  account: Account;
  disabled: boolean;
  onSave: (id: string, priority: number) => Promise<boolean>;
  t: Translate;
}) {
  const [value, setValue] = useState<number | null>(account.autoSwitchPriority);
  useEffect(() => setValue(account.autoSwitchPriority), [account.autoSwitchPriority]);

  const save = async () => {
    const priority = value === null ? 0 : Math.trunc(value);
    setValue(priority);
    if (priority === account.autoSwitchPriority) return;
    if (!await onSave(account.id, priority)) setValue(account.autoSwitchPriority);
  };

  return <InputNumber className="auto-switch-priority-input" size="small" precision={0} step={1}
    min={-2_147_483_648} max={2_147_483_647} value={value} disabled={disabled}
    aria-label={t("table.autoSwitchPriority")} onChange={setValue}
    onBlur={() => void save()} onPressEnter={(event) => event.currentTarget.blur()} />;
}

export function AutoSwitchThresholdInput({ account, disabled, onSave, t }: {
  account: Account;
  disabled: boolean;
  onSave: (id: string, threshold: number) => Promise<boolean>;
  t: Translate;
}) {
  const [value, setValue] = useState<number | null>(account.autoSwitchThreshold);
  useEffect(() => setValue(account.autoSwitchThreshold), [account.autoSwitchThreshold]);

  const save = async () => {
    const threshold = value === null ? 0 : Math.min(100, Math.max(0, value));
    setValue(threshold);
    if (threshold === account.autoSwitchThreshold) return;
    if (!await onSave(account.id, threshold)) setValue(account.autoSwitchThreshold);
  };

  return <InputNumber className="auto-switch-threshold-input" size="small" precision={1} step={1}
    min={0} max={100} suffix="%" value={value} disabled={disabled}
    aria-label={t("table.autoSwitchThreshold")} onChange={setValue}
    onBlur={() => void save()} onPressEnter={(event) => event.currentTarget.blur()} />;
}

function GlobalThresholdEditor({ value, disabled, saving, onChange, onSave, t }: {
  value: number | null;
  disabled: boolean;
  saving: boolean;
  onChange: (value: number | null) => void;
  onSave: () => void;
  t: Translate;
}) {
  return <div className="global-threshold-popover">
    <p>{t("table.globalAutoSwitchThresholdDescription")}</p>
    <div>
      <InputNumber size="small" precision={1} step={1} min={0} max={100} suffix="%"
        value={value} disabled={saving || disabled} onChange={onChange}
        aria-label={t("table.globalAutoSwitchThreshold")} />
      <Button type="primary" size="small" loading={saving} disabled={disabled}
        onClick={onSave}>{t("table.saveGlobalThreshold")}</Button>
    </div>
  </div>;
}

export function GlobalAutoSwitchThresholdControl({ threshold, disabled, onSave, t }: {
  threshold: number;
  disabled: boolean;
  onSave: (threshold: number) => Promise<boolean>;
  t: Translate;
}) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [value, setValue] = useState<number | null>(threshold);
  useEffect(() => setValue(threshold), [threshold]);

  const save = async () => {
    const nextThreshold = value === null ? 0 : Math.min(100, Math.max(0, value));
    setValue(nextThreshold);
    if (nextThreshold === threshold) {
      setOpen(false);
      return;
    }
    setSaving(true);
    const saved = await onSave(nextThreshold);
    setSaving(false);
    if (saved) setOpen(false);
    else setValue(threshold);
  };

  const content = <GlobalThresholdEditor value={value} disabled={disabled} saving={saving}
    onChange={setValue} onSave={() => void save()} t={t} />;

  return <span className="auto-switch-threshold-title">
    <span>{t("table.autoSwitchThreshold")}</span>
    <Popover title={t("table.globalAutoSwitchThreshold")} content={content} trigger="click"
      open={open} placement="bottomRight" styles={{ root: { maxWidth: 400 } }}
      onOpenChange={(nextOpen) => {
        if (!saving) {
          setValue(threshold);
          setOpen(nextOpen);
        }
      }}>
      <Tooltip title={t("table.globalAutoSwitchThresholdTooltip")}>
        <Button type="text" size="small" disabled={disabled} icon={<Settings size={14} />}
          aria-label={t("table.globalAutoSwitchThreshold")} />
      </Tooltip>
    </Popover>
  </span>;
}

export function ResetCreditsModal({ state, onClose, onRetry, language, t }: {
  state?: ResetCreditsLoadState;
  onClose: () => void;
  onRetry: () => void;
  language: Language;
  t: Translate;
}) {
  const count = resetCreditsCount(state);
  return <div className="modal-backdrop">
    <div className="modal reset-credits-modal">
      <button className="modal-close" onClick={onClose} aria-label={t("table.cancel")}><X size={17} /></button>
      <div className="modal-icon"><CalendarClock size={22} /></div>
      <h2>{t("table.resetCredits")}</h2>
      <p>{t("table.resetCredits")}: {count ?? "-"}</p>
      <ResetCreditsPanel state={state} onRetry={onRetry} language={language} t={t} />
    </div>
  </div>;
}

export function needsAccountAttention(account: Account, hotSwitchEnabled: boolean, showUsageNetworkErrors: boolean) {
  return shouldShowUsageError(account.usage.error, showUsageNetworkErrors)
    || (hotSwitchEnabled && !account.autoSwitchEnabled);
}
