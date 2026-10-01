import { guiText } from "../../i18n/guiText";
import { useState } from "react";
import { Alert, Button, Input, Segmented } from "antd";
import { useLanguage } from "../../hooks/useLanguage";
import { DreamSkinBrowser } from "../dreamSkin/DreamSkinBrowser";
import { DreamSkinOverlaySlider } from "../dreamSkin/DreamSkinOverlaySlider";
import { useDreamSkinCatalog } from "../dreamSkin/useDreamSkinCatalog";
import type { ThemeTab } from "../dreamSkin/types";
import { useGuiSkin, type GuiSkin } from "./guiSkin";
import { useGuiSkinLibrary } from "./useGuiSkinLibrary";
import styles from "./GuiSkinSettings.module.less";

export function GuiSkinSettings() {
  const { t } = useLanguage();
  const settings = useGuiSkin();
  const [themeTab, setThemeTab] = useState<ThemeTab>("builtIn");
  const [queries, setQueries] = useState({ builtIn: "", saved: "" });
  const catalog = useDreamSkinCatalog(themeTab);
  const library = useGuiSkinLibrary(catalog);
  const isBusy = library.busy !== null;
  const resourceUnavailable = !library.resources?.installed;
  const resourceMessage = library.resources?.phase === "error" ? guiText("皮肤图片下载失败，请重试。")
    : library.resources?.phase === "unsupported" ? guiText("当前设备暂不支持读取内置皮肤。") : guiText("正在准备皮肤图片，请稍候…");
  return <section className={styles.panel} aria-label={guiText("Codex GUI 皮肤")}>
    <div className={styles.toolbar}>
      <p className={styles.hint}>{guiText("从皮肤库中选择喜欢的背景，仅用于 Codex GUI。更改后自动保存。")}</p>
      <div className={styles.controls}>
        <Segmented<GuiSkin["mode"]> aria-label={guiText("皮肤使用方式")} value={settings.mode} disabled={isBusy}
          options={[{ value: "inherit", label: guiText("跟随皮肤页") }, { value: "custom", label: guiText("独立设置") },
            { value: "none", label: guiText("不使用皮肤") }]} onChange={(mode) => library.update({ mode })} />
        <DreamSkinOverlaySlider disabled={isBusy || settings.mode !== "custom" || !settings.themeId}
          opacity={settings.overlayOpacity}
          onChange={(overlayOpacity) => library.update({ overlayOpacity })} t={t} />
      </div>
      {settings.mode === "custom" && !settings.themeId && <p className={styles.hint}>{guiText("请选择下方的皮肤。")}</p>}
      <div className={styles.controls}>
        <Segmented<ThemeTab> aria-label={guiText("皮肤来源")} value={themeTab}
          options={[{ value: "builtIn", label: guiText("内置皮肤") },
            { value: "market", label: guiText("社区皮肤") }, { value: "saved", label: guiText("已保存") }]}
          onChange={(next) => { setThemeTab(next); if (next === "saved") void library.refreshSaved(); }} />
        <Input.Search className={styles.search} aria-label={guiText("搜索皮肤")} placeholder={guiText("搜索皮肤")} allowClear
          value={themeTab === "market" ? catalog.marketQuery : queries[themeTab]}
          onChange={(event) => themeTab === "market"
            ? catalog.setMarketQuery(event.target.value)
            : setQueries({ ...queries, [themeTab]: event.target.value })} />
        <Button size="small" disabled={isBusy} onClick={() => {
          void library.refreshSaved();
          if (themeTab === "market") catalog.refreshThemeMarket();
        }}>{guiText("刷新")}</Button>
      </div>
      {library.error && <Alert type="error" showIcon closable message={library.error}
        onClose={() => library.setError(null)} />}
      {resourceUnavailable && themeTab === "builtIn" && <Alert showIcon
        type={library.resources?.phase === "error" ? "error" : "info"}
        message={resourceMessage}
        action={library.resources?.phase === "error" && <Button size="small"
          onClick={() => void library.retry()}>{guiText("重试")}</Button>} />}
    </div>
    <div className={styles.browser}>
      <DreamSkinBrowser actions={library.actions} busy={library.busy} isBusy={isBusy}
        builtInQuery={queries.builtIn} savedQuery={queries.saved} catalog={catalog} savedThemes={library.savedThemes}
        resourcesReady={library.resources?.installed === true} showInstallHint={false}
        status={{ installed: false, activeThemeId: settings.mode === "custom" ? settings.themeId : null }}
        t={t} themeTab={themeTab} />
    </div>
  </section>;
}
