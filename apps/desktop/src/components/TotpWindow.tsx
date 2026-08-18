import { useCallback, useEffect, useMemo, useState } from "react";
import { ConfigProvider, theme as antdTheme } from "antd";
import enUS from "antd/locale/en_US";
import zhCN from "antd/locale/zh_CN";
import { Check } from "lucide-react";
import { loadAccounts, subscribeToBackendEvents } from "../api/backend";
import { useCloudAuth } from "../hooks/useCloudAuth";
import { useLanguage } from "../hooks/useLanguage";
import { useThemeColor } from "../hooks/useThemeColor";
import { useThemeMode } from "../hooks/useThemeMode";
import { useToast } from "../hooks/useToast";
import { useTotpEntries } from "../hooks/useTotpEntries";
import type { Account } from "../types";
import { normalizeTotpSecret, type TotpEntry } from "../utils/totp";
import { TotpManager } from "./TotpManager";

function toBoundTotpEntries(accounts: Account[]): TotpEntry[] {
  return accounts.flatMap((account) => {
    try {
      const secret = normalizeTotpSecret(account.privateDetails.totpSecret);
      return [{
        id: `account:${account.id}`,
        issuer: "ChatGPT",
        accountName: account.email,
        secret,
        algorithm: "SHA1" as const,
        digits: 6 as const,
        period: 30,
        createdAt: "1970-01-01T00:00:00.000Z",
        updatedAt: "1970-01-01T00:00:00.000Z",
      }];
    } catch {
      return [];
    }
  });
}

function useBoundTotpEntries(notify: (message: string) => void) {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const load = useCallback(() => {
    void loadAccounts().then(setAccounts).catch((error) => notify(String(error)));
  }, [notify]);
  useEffect(load, [load]);
  useEffect(() => subscribeToBackendEvents(load, () => undefined), [load]);
  return useMemo(() => toBoundTotpEntries(accounts), [accounts]);
}

export function TotpWindow() {
  const { message, notify } = useToast();
  const { language, t } = useLanguage();
  const themeColor = useThemeColor(notify);
  const themeMode = useThemeMode();
  const cloud = useCloudAuth(notify, t);
  const manager = useTotpEntries({
    cloudAuthenticated: cloud.state.authenticated,
    notify,
    t,
  });
  const boundEntries = useBoundTotpEntries(notify);

  useEffect(() => {
    document.documentElement.classList.add("totp-window-page");
    return () => document.documentElement.classList.remove("totp-window-page");
  }, []);

  return (
    <ConfigProvider locale={language === "zh" ? zhCN : enUS} theme={{
      algorithm: themeMode.mode === "dark"
        ? [antdTheme.darkAlgorithm, antdTheme.compactAlgorithm]
        : antdTheme.compactAlgorithm,
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
          <TotpManager boundEntries={boundEntries} manager={manager} t={t} />
        </section>
        {message && <div className="toast"><Check size={17} />{message}</div>}
      </main>
    </ConfigProvider>
  );
}
