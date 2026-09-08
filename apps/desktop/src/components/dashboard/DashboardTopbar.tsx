import type { ReactNode } from "react";
import { Dropdown } from "antd";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Minus, Search, Square, X } from "lucide-react";
import type { NavigationStyle } from "../../hooks/useNavigationStyle";
import type { Translate } from "../../i18n";
import type { DashboardMenuItems } from "./dashboardMenuItems";

interface DashboardTopbarProps {
  menuItems: DashboardMenuItems;
  nativeWindowControls: boolean;
  navigationStyle: NavigationStyle;
  onMenuAction: (action: string) => void;
  onSearch: () => void;
  onWindowError: (message: string) => void;
  sidebarToggle?: ReactNode;
  t: Translate;
  tools: ReactNode;
}

const MENU_GROUPS = ["file", "view", "navigate", "tools", "cloud", "help"] as const;

function WindowControls({ onError, t }: { onError: (message: string) => void; t: Translate }) {
  const run = (action: "minimize" | "toggleMaximize" | "close") => {
    void getCurrentWindow()[action]().catch((error: unknown) => onError(String(error)));
  };
  return (
    <div className="window-controls">
      <button type="button" className="window-control" aria-label={t("windowMenu.minimize")}
        onClick={() => run("minimize")}><Minus size={16} /></button>
      <button type="button" className="window-control" aria-label={t("windowMenu.maximize")}
        onClick={() => run("toggleMaximize")}><Square size={13} /></button>
      <button type="button" className="window-control window-control-close" aria-label={t("windowMenu.close")}
        onClick={() => run("close")}><X size={17} /></button>
    </div>
  );
}

export function DashboardTopbar(props: DashboardTopbarProps) {
  const { menuItems, nativeWindowControls, navigationStyle, onMenuAction, onSearch, onWindowError, t, tools } = props;
  const searchLabel = `${t("menuSearch.label")} (${t("menuSearch.shortcut")})`;
  return (
    <header className={`window-titlebar${nativeWindowControls ? "" : " window-titlebar-content"}`}>
      <nav className="window-menu-bar" aria-label={t("windowMenu.aria")}>
        {props.sidebarToggle}
        {MENU_GROUPS.map((group) => (
          <Dropdown key={group} trigger={["click"]} placement="bottomLeft"
            overlayClassName="window-menu-dropdown" menu={{
              items: menuItems[group],
              selectedKeys: group === "view" ? [`navigation-style-${navigationStyle}`] : undefined,
              onClick: ({ key }) => onMenuAction(key),
            }}>
            <button type="button" className="window-menu-trigger">{t(`windowMenu.${group}`)}</button>
          </Dropdown>
        ))}
        <button type="button" className="window-menu-search-trigger" aria-label={searchLabel}
          title={searchLabel} onClick={onSearch}><Search size={14} /></button>
      </nav>
      <div className="window-titlebar-drag-region" data-tauri-drag-region={nativeWindowControls || undefined} />
      <div className="window-titlebar-tools">{tools}</div>
      {nativeWindowControls && <WindowControls onError={onWindowError} t={t} />}
    </header>
  );
}
