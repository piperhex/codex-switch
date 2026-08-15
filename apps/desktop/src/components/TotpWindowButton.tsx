import { Button } from "antd";
import { ShieldCheck } from "lucide-react";
import { showTotpWindow } from "../api/backend";
import type { Translate } from "../i18n";

interface TotpWindowButtonProps {
  notify: (message: string) => void;
  t: Translate;
}

export function TotpWindowButton({ notify, t }: TotpWindowButtonProps) {
  const openWindow = () => {
    void showTotpWindow().catch((error) => notify(String(error)));
  };

  return (
    <Button className="refresh-all proxy-topbar-action" size="small"
      icon={<ShieldCheck size={14} />} onClick={openWindow}>
      {t("totp.action")}
    </Button>
  );
}
