import { useId, useRef, useState, type ReactNode } from "react";
import { Popover } from "antd";
import { ChevronLeft, BriefcaseBusiness } from "lucide-react";
import type { Translate } from "../../i18n";
import styles from "./AccountToolbox.module.less";

interface AccountToolboxProps {
  children: ReactNode;
  t: Translate;
}

export function AccountToolbox({ children, t }: AccountToolboxProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  return (
    <Popover open={open} onOpenChange={setOpen} placement="leftTop" arrow={false}
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
          {children}
        </div>
      )}>
      <button ref={triggerRef} type="button" className={`refresh-all ${styles.trigger}`}
        aria-expanded={open} aria-controls={open ? panelId : undefined}
        onKeyDown={(event) => {
          if (event.key === "Escape") setOpen(false);
        }}>
        <ChevronLeft size={14} className={open ? styles.expanded : undefined} aria-hidden="true" />
        <BriefcaseBusiness size={15} aria-hidden="true" />
        <span>{t("actions.toolbox")}</span>
      </button>
    </Popover>
  );
}
