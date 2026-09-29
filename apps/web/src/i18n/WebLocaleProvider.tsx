import { useEffect, type ReactNode } from 'react';
import { ConfigProvider as AntConfigProvider } from 'antd';
import { ConfigProvider as MobileConfigProvider } from 'antd-mobile';
import { setDefaultConfig } from 'antd-mobile/es/components/config-provider';
import zhCN from 'antd/locale/zh_CN';
import enUS from 'antd/locale/en_US';
import zhCNMobile from 'antd-mobile/es/locales/zh-CN';
import enUSMobile from 'antd-mobile/es/locales/en-US';
import { useLanguage } from './language';

export function WebLocaleProvider({ children }: { children: ReactNode }) {
  const language = useLanguage();
  useEffect(() => {
    document.documentElement.lang = language === 'en' ? 'en' : 'zh-CN';
    document.title = language === 'en' ? 'Codex Remote Web - Remote chat and account management'
      : 'Codex Remote Web - 远程 Codex 聊天与账号管理';
  }, [language]);
  // Imperative dialogs are rendered outside the provider tree.
  useEffect(() => { setDefaultConfig({ locale: language === 'en' ? enUSMobile : zhCNMobile }); }, [language]);
  return <AntConfigProvider locale={language === 'en' ? enUS : zhCN}
    theme={{ token: { colorPrimary: '#0b9b7c', borderRadius: 12,
      fontFamily: "Inter, 'PingFang SC', 'Microsoft YaHei', sans-serif" } }}>
    <MobileConfigProvider locale={language === 'en' ? enUSMobile : zhCNMobile}>
      {children}
    </MobileConfigProvider>
  </AntConfigProvider>;
}
