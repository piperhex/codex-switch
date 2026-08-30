import { Button } from "antd";
import { RefreshCw } from "lucide-react";
import type { Language, Translate } from "../../i18n";
import type { Account, ResetCreditsLoadState } from "../../types";
import { formatSystemTime } from "../../utils/format";
import { ResetCreditsPanel } from "./ResetCreditsPanel";

const MASKED_VALUE = "••••••••";

function detailValue(value: string, masked: boolean) {
  if (!value) return "-";
  return masked ? MASKED_VALUE : value;
}

export function AccountExpandedPanel({
  account,
  resetCredits,
  privacyMode,
  hideAccountNotes,
  onRefreshResetCredits,
  language,
  t,
}: {
  account: Account;
  resetCredits?: ResetCreditsLoadState;
  privacyMode: boolean;
  hideAccountNotes: boolean;
  onRefreshResetCredits: () => void;
  language: Language;
  t: Translate;
}) {
  const note = detailValue(account.note, hideAccountNotes && Boolean(account.note));
  const sensitive = privacyMode;
  const lastUpdated = resetCredits?.fetchedAt
    ? t("table.resetCreditsUpdated", { time: formatSystemTime(resetCredits.fetchedAt, language) })
    : t("table.resetCreditsUnknown");

  return (
    <div className="account-expanded-panel">
      <section className="account-details-section" aria-labelledby={`account-details-${account.id}`}>
        <h3 id={`account-details-${account.id}`}>{t("note.title")}</h3>
        <dl className="account-details-grid">
          <div><dt>{t("note.label")}</dt><dd>{note}</dd></div>
          <div><dt>{t("note.expirationDate")}</dt><dd>{detailValue(account.expiresAt, false)}</dd></div>
          <div><dt>{t("note.phoneNumber")}</dt>
            <dd>{detailValue(account.privateDetails.phoneNumber, sensitive)}</dd></div>
          <div><dt>{t("note.password")}</dt><dd>{detailValue(account.privateDetails.password, sensitive)}</dd></div>
          <div><dt>{t("note.totp")}</dt><dd>{detailValue(account.privateDetails.totpSecret, sensitive)}</dd></div>
        </dl>
      </section>
      <section className="account-reset-section" aria-labelledby={`reset-credits-${account.id}`}>
        <div className="account-reset-section-header">
          <h3 id={`reset-credits-${account.id}`}>{t("table.resetCredits")}</h3>
          <div className="account-reset-section-actions">
            <span>{lastUpdated}</span>
            <Button size="small"
              icon={<RefreshCw size={13} className={resetCredits?.status === "loading" ? "spin" : undefined} />}
              loading={resetCredits?.status === "loading"} onClick={onRefreshResetCredits}>
              {t("actions.refreshResetCredits")}
            </Button>
          </div>
        </div>
        <ResetCreditsPanel state={resetCredits} onRetry={onRefreshResetCredits} missingState="unknown"
          language={language} t={t} />
      </section>
    </div>
  );
}
