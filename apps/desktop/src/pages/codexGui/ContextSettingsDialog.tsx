import { guiText } from "../../i18n/guiText";
import { useId, useState } from "react";
import { AutoComplete, Button, Input, Modal, Spin } from "antd";
import { CONTEXT_CAPACITY_PRESETS_K } from "../../../../../shared/remote-chat/contextSettings";
import { useContextSettings } from "./useContextSettings";
import styles from "./ContextUsageButton.module.less";

const capacityOptions = CONTEXT_CAPACITY_PRESETS_K.map((value) => ({ value: String(value), label: `${value}K` }));

export function ContextSettingsDialog({ threadId, onClose }: { threadId: string; onClose: () => void }) {
  const editor = useContextSettings(threadId);
  const [presetsOpen, setPresetsOpen] = useState(false);
  const id = useId();
  const save = async () => { if (await editor.save()) onClose(); };
  return <Modal open centered width={360} title={guiText("对话上下文设置")} onCancel={onClose}
    closable={!editor.saving} maskClosable={!editor.saving} keyboard={!editor.saving}
    footer={<>
      <Button disabled={editor.saving} onClick={onClose}>{guiText("取消")}</Button>
      <Button type="primary" loading={editor.saving} disabled={editor.loading || !editor.loaded}
        onClick={() => void save()}>{guiText("保存")}</Button>
    </>}>
    <div className={styles.settings}>
      <p className={styles.hint}>{guiText("仅用于当前对话。保存后立即应用；正在回复时会先暂停，修改后自动继续。")}</p>
      {editor.loading && <div role="status"><Spin size="small" />  {guiText("正在读取设置…")}</div>}
      {editor.loaded && <>
        <label htmlFor={id}>{guiText("上下文容量（K Token）")}</label>
        <AutoComplete id={id} value={editor.value} options={capacityOptions} disabled={editor.saving}
          onChange={editor.setValue} onOpenChange={setPresetsOpen} defaultActiveFirstOption={false}>
          <Input aria-label={guiText("上下文容量（K Token）")} inputMode="decimal" placeholder={guiText("选择或输入容量，留空使用默认值")}
            onPressEnter={(event) => { if (!presetsOpen && !event.nativeEvent.isComposing) void save(); }} />
        </AutoComplete>
        <div className={styles.settingHelp}>
          <span className={styles.hint}>{guiText("1 K = 1000 Token；留空使用默认容量。")}</span>
          <Button type="link" size="small" disabled={editor.saving} onClick={() => editor.setValue("")}>{guiText("恢复默认")}</Button>
        </div>
        <p className={styles.hint}>{guiText("用量会在收到回复后更新。可用容量受模型上限和预留空间影响。")}</p>
      </>}
      {editor.error && <div role="alert" className={styles.error}>{editor.error}
        {!editor.loaded && <Button type="link" size="small" onClick={editor.retry}>{guiText("重试")}</Button>}
      </div>}
    </div>
  </Modal>;
}
