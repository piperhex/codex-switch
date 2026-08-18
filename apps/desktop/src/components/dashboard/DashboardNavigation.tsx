import {
  BarChart3,
  FolderOpen,
  PackageOpen,
  Palette,
  Server,
  Settings,
  UserRound,
} from "lucide-react";
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
  collapsed?: boolean;
  onPageChange: (page: DashboardPage) => void;
  page: DashboardPage;
  t: Translate;
  variant?: "top" | "sidebar";
}

const NAVIGATION_ITEMS = [
  { page: "accounts", icon: UserRound, labelKey: "nav.accounts" },
  { page: "sessions", icon: FolderOpen, labelKey: "nav.sessions" },
  { page: "providers", icon: Server, labelKey: "nav.providers" },
  { page: "tokens", icon: BarChart3, labelKey: "nav.tokenUsage" },
  { page: "dreamSkin", icon: Palette, labelKey: "nav.dreamSkin" },
  { page: "skills", icon: PackageOpen, labelKey: "nav.skills" },
] as const;

export function DashboardNavigation({
  collapsed = false,
  onPageChange,
  page,
  t,
  variant = "top",
}: DashboardNavigationProps) {
  const items = variant === "sidebar"
    ? [...NAVIGATION_ITEMS, { page: "settings", icon: Settings, labelKey: "nav.settings" } as const]
    : NAVIGATION_ITEMS;
  return (
    <nav className={variant === "sidebar" ? "sidebar-tabs" : "top-tabs"}
      aria-label={t("nav.aria")}>
      {items.map((item) => {
        const Icon = item.icon;
        const label = t(item.labelKey);
        return (
          <button key={item.page} className={`${page === item.page ? "selected" : ""}${
            item.page === "settings" ? " sidebar-nav-settings" : ""
          }`} aria-label={collapsed ? label : undefined} title={collapsed ? label : undefined}
            onClick={() => onPageChange(item.page)}>
            <Icon size={19} /><span>{label}</span>
          </button>
        );
      })}
    </nav>
  );
}
