import { t, useLanguage } from '../i18n';
import { ArrowLeft, Box, FileText, Github, Globe } from 'lucide-react';
import { BrandMark } from '../components/BrandMark';
import { SettingsRow } from './SettingsRow';
import { version } from '../../../../package.json';

export function AboutPage({ onBack }: { onBack: () => void }) {
  useLanguage();
  return <div className="page-body settings-page about-page">
    <header className="settings-navigation"><button type="button" className="icon-button"
      aria-label={t("返回设置")} onClick={onBack}><ArrowLeft size={22} /></button><h1>{t("关于")}</h1></header>
    <section className="settings-group about-identity">
      <BrandMark />
      <div><h2>Remote AI <small>Web</small></h2><p>v{version}</p></div>
      <p>{t("管理账号用量，随时连接桌面设备。")}</p>
    </section>
    <section className="settings-group">
      <SettingsRow label={t("当前版本")} value={`v${version}`} icon={Box} tone="blue" />
      <SettingsRow label={t("运行平台")} value={t("Web 浏览器")} icon={Globe} tone="blue" />
      <SettingsRow label={t("开源许可")} value="Apache-2.0" icon={FileText} tone="orange" />
    </section>
    <section className="settings-group"><a className="settings-link"
      href="https://github.com/piperhex/codex-switch/releases"
      target="_blank" rel="noreferrer"><Github size={21} /><span>{t("开源项目与历史版本")}</span></a></section>
    <p className="settings-hint">{t("网页版由服务端更新，无需下载安装包。")}</p>
  </div>;
}
