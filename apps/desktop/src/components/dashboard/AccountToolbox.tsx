import { useId, useRef, useState, type ReactNode } from "react";
import { Popover } from "antd";
import { ChevronDown, ChevronLeft, BriefcaseBusiness } from "lucide-react";
import type { Translate } from "../../i18n";
import { DashboardNavigation, isToolboxPage, type DashboardPage } from "./DashboardNavigation";
import styles from "./AccountToolbox.module.less";

interface AccountToolboxProps {
  children?: ReactNode;
  navigation?: { page: DashboardPage; onPageChange: (page: DashboardPage) => void };
  t: Translate;
}

export function AccountToolbox({ children, navigation, t }: AccountToolboxProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const Chevron = navigation ? ChevronDown : ChevronLeft;
  const selected = navigation && isToolboxPage(navigation.page);

  return (
    <Popover open={open} onOpenChange={setOpen} placement={navigation ? "bottomRight" : "leftTop"} arrow={false}
      trigger="hover" mouseLeaveDelay={0.2}
      styles={{ root: { maxWidth: 400 }, body: { padding: 8 } }}
      content={(
        <div id={panelId} className={styles.actions} role="group" aria-label={t("actions.toolbox")}
          onKeyDown={(event) => {
            if (event.key !== "Escape") return;
            event.stopPropagation();
            triggerRef.current?.focus();
            setOpen(false);
          }}>
          {navigation && <DashboardNavigation page={navigation.page} t={t} variant="toolbox"
            onPageChange={(page) => {
              navigation.onPageChange(page);
              setOpen(false);
            }} />}
          {children}
        </div>
      )}>
      <button ref={triggerRef} type="button"
        className={`refresh-all ${styles.trigger}${selected ? ` ${styles.selected}` : ""}`}
        aria-expanded={open} aria-controls={open ? panelId : undefined}
        onKeyDown={(event) => {
          if (event.key === "Escape") setOpen(false);
        }}>
        <Chevron size={14} className={open ? styles.expanded : undefined} aria-hidden="true" />
        <BriefcaseBusiness size={15} aria-hidden="true" />
        <span>{t("actions.toolbox")}</span>
      </button>
    </Popover>
  );
}
