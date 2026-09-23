import { Tabs } from "antd";
import { ProxySessionManager } from "../../components/ProxySessionManager";
import type { Language, Translate } from "../../i18n";
import { ErrorLogsPage } from "../ErrorLogsPage";
import styles from "./index.module.less";

export type LogDiagnosticsTab = "errorLogs" | "proxySessions";

interface LogDiagnosticsPageProps {
  activeTab: LogDiagnosticsTab;
  language: Language;
  onTabChange: (tab: LogDiagnosticsTab) => void;
  t: Translate;
}

export function LogDiagnosticsPage({ activeTab, language, onTabChange, t }: LogDiagnosticsPageProps) {
  return (
    <Tabs className={styles.tabs} activeKey={activeTab} destroyOnHidden animated={false}
      onChange={(key) => onTabChange(key as LogDiagnosticsTab)} items={[
        {
          key: "errorLogs", label: t("errorLogs.title"),
          children: <div className={styles.logs}><ErrorLogsPage language={language} t={t} /></div>,
        },
        {
          key: "proxySessions", label: t("nav.proxySessions"),
          children: <ProxySessionManager t={t} />,
        },
      ]} />
  );
}
