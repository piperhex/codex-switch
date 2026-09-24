import { useState } from "react";
import { Button, ColorPicker, Segmented, Switch, theme } from "antd";
import { DEFAULT_GUI_THEME, saveGuiTheme, useGuiTheme, type GuiTheme } from "./guiTheme";
import styles from "./GuiThemeSettings.module.less";

export function GuiThemeSettings() {
  const settings = useGuiTheme();
  const { token } = theme.useToken();
  const [error, setError] = useState("");
  const update = (patch: Partial<GuiTheme>) => {
    setError(saveGuiTheme(patch) ? "" : "主题未保存，请重试。");
  };
  return <section className={styles.panel} aria-label="主题设置">
    <h3>外观</h3>
    <p className={styles.hint}>为 Codex GUI 选择喜欢的外观，更改后自动保存。</p>
    <Segmented<GuiTheme["mode"]> aria-label="Codex GUI 外观" value={settings.mode}
      options={[{ value: "inherit", label: "跟随应用" }, { value: "light", label: "浅色" },
        { value: "dark", label: "深色" }]} onChange={(mode) => update({ mode })} />
    <h3>主题色</h3>
    <div className={styles.controls}>
      <label htmlFor="gui-theme-color-inherit">跟随应用主题色</label>
      <Switch id="gui-theme-color-inherit" size="small" checked={settings.color === null}
        onChange={(inherit) => update({ color: inherit ? null : token.colorPrimary })} />
      <ColorPicker value={settings.color ?? token.colorPrimary} disabled={settings.color === null}
        showText disabledAlpha format="hex" onChangeComplete={(color) => update({ color: color.toHexString() })} />
    </div>
    {error && <p className={styles.error} role="alert">{error}</p>}
    <div className={styles.preview} aria-label="主题预览">
      <div className={styles.sidebar}><strong>Codex GUI</strong><span>新的对话</span></div>
      <div className={styles.conversation}>
        <span className={styles.caption}>预览</span>
        <p>你好，今天想一起完成什么？</p>
        <div className={styles.reply}>一起把想法变成现实。</div>
        <div className={styles.composer}><span>输入你的想法…</span><span className={styles.send}>↑</span></div>
      </div>
    </div>
    <Button onClick={() => update(DEFAULT_GUI_THEME)}
      disabled={settings.mode === "inherit" && settings.color === null}>恢复默认</Button>
  </section>;
}
