import { Button, Spin } from "antd";
import { useLanguage } from "../../hooks/useLanguage";
import { SystemPromptPage } from "../SystemPromptPage";
import { useGuiSystemPrompts } from "./useGuiSystemPrompts";
import styles from "./GuiAutoSwitchSettingsDialog.module.less";

export function GuiSystemPromptSettings() {
  const editor = useGuiSystemPrompts();
  const { t } = useLanguage();
  return <section className={styles.promptPanel} aria-label="Codex GUI 系统提示词">
    {editor.loading && <div className={styles.loading} role="status"><Spin size="small" />正在读取设置…</div>}
    {editor.error && <div className={styles.error} role="alert">
      <span>{editor.error}</span>
      {!editor.settings && <Button size="small" disabled={editor.loading}
        onClick={() => void editor.load()}>重试</Button>}
    </div>}
    {editor.settings && <SystemPromptPage embedded {...editor.settings} loading={editor.saving} t={t}
      notice="仅用于 Codex GUI 对话。修改会自动保存，并从下一次请求开始生效。"
      onFilterEnabledChange={(filterEnabled) => void editor.update({ filterEnabled })}
      onFilterRulesChange={(filterRules) => editor.update({ filterRules })}
      onInjectionEnabledChange={(injectionEnabled) => void editor.update({ injectionEnabled })}
      onInjectionPromptsChange={(injectionPrompts) => editor.update({ injectionPrompts })} />}
  </section>;
}
