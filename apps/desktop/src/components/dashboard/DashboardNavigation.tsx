import { BarChart3, FolderOpen, PackageOpen, Palette, Server, UserRound } from "lucide-react";
import type { Translate } from "../../i18n";

export type DashboardPage =
  | "accounts"
  | "providers"
  | "tokens"
  | "dreamSkin"
  | "skills"
  | "sessions"
  | "settings";

interface DashboardNavigationProps {
  onPageChange: (page: DashboardPage) => void;
  page: DashboardPage;
  t: Translate;
}

export function DashboardNavigation({ onPageChange, page, t }: DashboardNavigationProps) {
  return (
    <nav className="top-tabs" aria-label={t("nav.aria")}>
      <button className={page === "accounts" ? "selected" : ""} onClick={() => onPageChange("accounts")}>
        <UserRound size={19} />{t("nav.accounts")}
      </button>
      <button className={page === "sessions" ? "selected" : ""} onClick={() => onPageChange("sessions")}>
        <FolderOpen size={19} />{t("nav.sessions")}
      </button>
      <button className={page === "providers" ? "selected" : ""} onClick={() => onPageChange("providers")}>
        <Server size={19} />{t("nav.providers")}
      </button>
      <button className={page === "tokens" ? "selected" : ""} onClick={() => onPageChange("tokens")}>
        <BarChart3 size={19} />{t("nav.tokenUsage")}
      </button>
      <button className={page === "dreamSkin" ? "selected" : ""} onClick={() => onPageChange("dreamSkin")}>
        <Palette size={19} />{t("nav.dreamSkin")}
      </button>
      <button className={page === "skills" ? "selected" : ""} onClick={() => onPageChange("skills")}>
        <PackageOpen size={19} />{t("nav.skills")}
      </button>
    </nav>
  );
}
