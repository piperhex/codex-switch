import { useState } from "react";
import { Modal } from "antd";
import { Wrench } from "lucide-react";
import { hasLocalBackend, repairCodexConfig } from "../../api/backend";
import type { Translate } from "../../i18n";

interface CodexConfigRepairButtonProps {
  disabled: boolean;
  notify: (message: string) => void;
  t: Translate;
}

export function CodexConfigRepairButton({
  disabled,
  notify,
  t,
}: CodexConfigRepairButtonProps) {
  const [repairing, setRepairing] = useState(false);

  const repair = async () => {
    setRepairing(true);
    try {
      const result = await repairCodexConfig();
      notify(t(result.proxyConfigReapplied
        ? "toast.codexConfigRepairedWithProxy"
        : "toast.codexConfigRepaired"));
    } catch (error) {
      console.error(error);
      notify(t("toast.codexConfigRepairFailed"));
    } finally {
      setRepairing(false);
    }
  };

  const confirmRepair = () => {
    Modal.confirm({
      title: t("actions.repairCodexConfigConfirmTitle"),
      content: <span className="compact-confirm-copy">
        {t("actions.repairCodexConfigConfirmDescription")}
      </span>,
      okText: t("actions.repairCodexConfigConfirmAction"),
      cancelText: t("table.cancel"),
      okButtonProps: { danger: true },
      onOk: repair,
    });
  };

  return (
    <button type="button" className="refresh-all proxy-topbar-action"
      disabled={disabled || repairing || !hasLocalBackend} onClick={confirmRepair}>
      <Wrench size={14} />
      <span>{t(repairing ? "actions.repairingCodexConfig" : "actions.repairCodexConfig")}</span>
    </button>
  );
}
