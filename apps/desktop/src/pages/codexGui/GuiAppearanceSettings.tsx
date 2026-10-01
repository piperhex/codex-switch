import { guiText } from "../../i18n/guiText";
import { useState } from "react";
import { Button, InputNumber, Slider } from "antd";
import {
  DEFAULT_GUI_FONT_SIZE, guiFontStyle, MAX_GUI_FONT_SIZE, MIN_GUI_FONT_SIZE, saveGuiFontSize, useGuiFontSize,
} from "./guiAppearance";
import styles from "./GuiAppearanceSettings.module.less";

export function GuiAppearanceSettings() {
  const fontSize = useGuiFontSize();
  const [error, setError] = useState("");
  const update = (value: number | null) => {
    if (value !== null) setError(saveGuiFontSize(value) ? "" : guiText("字体大小未保存，请重试。"));
  };
  return <section className={styles.panel} aria-label={guiText("界面设置")}>
    <h3>{guiText("字体大小")}</h3>
    <p className={styles.hint}>{guiText("调整对话、输入框和代码的文字大小，更改后自动保存。")}</p>
    <div className={styles.controls}>
      <Slider min={MIN_GUI_FONT_SIZE} max={MAX_GUI_FONT_SIZE} value={fontSize} onChange={update}
        ariaLabelForHandle={guiText("字体大小")} tooltip={{ open: false }} />
      <InputNumber aria-label={guiText("字体大小")} min={MIN_GUI_FONT_SIZE} max={MAX_GUI_FONT_SIZE} precision={0}
        value={fontSize} onChange={update} suffix="px" />
      <Button onClick={() => update(DEFAULT_GUI_FONT_SIZE)} disabled={fontSize === DEFAULT_GUI_FONT_SIZE}>
        {guiText("恢复默认")}</Button>
    </div>
    {error && <p className={styles.error} role="alert">{error}</p>}
    <div className={styles.preview} style={guiFontStyle(fontSize)} aria-label={guiText("字体预览")}>
      <span className={styles.caption}>{guiText("预览")}</span>
      <p>{guiText("你好，今天想一起完成什么？")}</p>
      <p>{guiText("调整到舒服的大小，让阅读和编写更轻松。")}</p>
      <pre><code>const message = "Hello, Codex!";</code></pre>
    </div>
  </section>;
}
