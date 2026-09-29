import { t, useLanguage } from '../i18n';
import { Button } from "antd-mobile";
import { Download } from "lucide-react";
import { AdaptiveSheet } from "./AdaptiveSheet";

const DESKTOP_DOWNLOAD_URL = "https://github.com/piperhex/codex-switch/releases/latest";

interface RegistrationSheetProps {
  open: boolean;
  onClose: () => void;
}

export function RegistrationSheet({ open, onClose }: RegistrationSheetProps) {
  useLanguage();
  return <AdaptiveSheet open={open} title={t("在客户端注册")} onClose={onClose} width={440}>
    <div className="registration-guide">
      <p>{t("请下载最新版 Codex Remote 电脑客户端，并在客户端完成注册。")}</p>
      <p>{t("注册后，即可使用同一账号登录网页版。")}</p>
      <div className="sheet-actions">
        <a className="registration-download" href={DESKTOP_DOWNLOAD_URL} target="_blank" rel="noopener noreferrer">
          <Download size={18} aria-hidden="true" />{t("下载最新版客户端")}</a>
        <Button block onClick={onClose}>{t("返回登录")}</Button>
      </div>
    </div>
  </AdaptiveSheet>;
}
