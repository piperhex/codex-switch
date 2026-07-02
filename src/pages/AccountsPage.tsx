import { ArrowRight, LogIn, RefreshCw } from "lucide-react";
import type { Language, Translate } from "../i18n";
import type { Account } from "../types";
import { AccountTable } from "../components/accounts/AccountTable";

export function AccountsPage({ accounts, loading, busyAccountId, onAdd, onSwitch, onRefresh, onDelete, language, t }: {
  accounts: Account[];
  loading: boolean;
  busyAccountId: string | null;
  onAdd: () => void;
  onSwitch: (id: string) => void;
  onRefresh: (id: string) => void;
  onDelete: (id: string) => void;
  language: Language;
  t: Translate;
}) {
  if (loading) return <div className="loading-state"><RefreshCw className="spin" />{t("accounts.loading")}</div>;
  if (!accounts.length) {
    return (
      <div className="empty-state">
        <div><LogIn size={28} /></div><h2>{t("accounts.empty.title")}</h2>
        <p>{t("accounts.empty.description")}</p>
        <button className="primary-button" onClick={onAdd}>{t("accounts.empty.addFirst")}<ArrowRight size={17} /></button>
      </div>
    );
  }
  return <AccountTable accounts={accounts} busyAccountId={busyAccountId}
    onSwitch={onSwitch} onRefresh={onRefresh} onDelete={onDelete} language={language} t={t} />;
}
