import { Modal } from "antd";
import type { Translate } from "../../i18n";

type OfficialAuthAccountChangeOptions = {
  accountId: string | null;
  currentAccountId: string | null;
  onConfirm: (accountId: string | null) => void;
  t: Translate;
};

export function confirmOfficialAuthAccountChange({
  accountId, currentAccountId, onConfirm, t,
}: OfficialAuthAccountChangeOptions) {
  if (accountId === null || currentAccountId !== null) {
    onConfirm(accountId);
    return;
  }

  Modal.confirm({
    title: t("providers.proxy.openaiAuthConfirmTitle"),
    content: <span className="compact-confirm-copy">{t("providers.proxy.openaiAuthConfirmDescription")}</span>,
    centered: true,
    okText: t("providers.proxy.openaiAuthConfirmButton"),
    cancelText: t("table.cancel"),
    okType: "primary",
    okButtonProps: { danger: true },
    autoFocusButton: "cancel",
    maskClosable: false,
    onOk: () => onConfirm(accountId),
  });
}
