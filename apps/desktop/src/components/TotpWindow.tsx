import { useEffect } from "react";
import { ConfigProvider, theme as antdTheme } from "antd";
import enUS from "antd/locale/en_US";
import zhCN from "antd/locale/zh_CN";
import { Check } from "lucide-react";
import { useCloudAuth } from "../hooks/useCloudAuth";
import { useLanguage } from "../hooks/useLanguage";
import { useThemeColor } from "../hooks/useThemeColor";
import { useToast } from "../hooks/useToast";
import { useTotpEntries } from "../hooks/useTotpEntries";
import { TotpManager } from "./TotpManager";

export function TotpWindow() {
  const { message, notify } = useToast();
  const { language, t } = useLanguage();
  const themeColor = useThemeColor(notify);
  const cloud = useCloudAuth(notify, t);
  const manager = useTotpEntries({
    cloudAuthenticated: cloud.state.authenticated,
    notify,
    t,
  });

  useEffect(() => {
    document.documentElement.classList.add("totp-window-page");
    return () => document.documentElement.classList.remove("totp-window-page");
  }, []);

  return (
    <ConfigProvider locale={language === "zh" ? zhCN : enUS} theme={{
      algorithm: antdTheme.compactAlgorithm,
      token: {
        colorPrimary: themeColor.color,
        borderRadius: 6,
        fontFamily: "\"DM Sans\", \"Microsoft YaHei UI\", sans-serif",
      },
    }}>
      <main className="totp-window-shell">
        <header className="totp-window-header">
          <span>AUTHENTICATOR</span>
          <h1>{t("totp.title")}</h1>
        </header>
        <section className="totp-window-content">
          <TotpManager manager={manager} t={t} />
        </section>
        {message && <div className="toast"><Check size={17} />{message}</div>}
      </main>
    </ConfigProvider>
  );
}
