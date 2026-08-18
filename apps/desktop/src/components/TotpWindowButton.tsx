import { Button } from "antd";
import { ShieldCheck } from "lucide-react";
import { showTotpWindow } from "../api/backend";
import type { Translate } from "../i18n";

interface TotpWindowButtonProps {
  notify: (message: string) => void;
  t: Translate;
  variant?: "sidebar" | "toolbar";
}

export function TotpWindowButton({ notify, t, variant = "toolbar" }: TotpWindowButtonProps) {
  const openWindow = () => {
    void showTotpWindow().catch((error) => notify(String(error)));
  };

  if (variant === "sidebar") {
    return (
      <button type="button" aria-label={t("totp.action")} title={t("totp.action")} onClick={openWindow}>
        <ShieldCheck size={19} aria-hidden="true" /><span>{t("totp.action")}</span>
      </button>
    );
  }

  return (
    <Button className="refresh-all proxy-topbar-action" size="small"
      icon={<ShieldCheck size={14} />} onClick={openWindow}>
      {t("totp.action")}
    </Button>
  );
}
