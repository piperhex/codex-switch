import { useState } from "react";
import { Alert, Button, Empty, Spin, Tag } from "antd";
import { CheckCircle2, CodeXml, FileSliders, RefreshCw } from "lucide-react";
import { hasLocalBackend } from "../api/backend";
import { ConfigForm } from "./codexConfig/ConfigForm";
import { TomlEditorModal } from "./codexConfig/TomlEditorModal";
import { useCodexConfig } from "./codexConfig/useCodexConfig";
import styles from "./codexConfig/pageStyles.module.less";

export function CodexConfigPage({ active, homeKey = "" }: { active: boolean; homeKey?: string }) {
  const config = useCodexConfig(active, homeKey);
  const [editorOpen, setEditorOpen] = useState(false);
  const document = config.document;
  const busy = config.pending > 0;
  if (!hasLocalBackend) return <Empty description="请在 Codex Switch 桌面端打开配置。" />;

  return (
    <div className={styles.page}>
      <section className={styles.overview}>
        <div className={styles.fileIcon}><FileSliders size={24} /></div>
        <div className={styles.copy}>
          <h2>config.toml</h2>
          <p>管理当前 Codex Home 的配置。输入后离开输入框，或选择选项后自动保存。</p>
          <span>未设置的项目沿用 Codex 默认值；部分更改在新任务或重启后生效。</span>
        </div>
        <div className={styles.actions}>
          <span role="status" aria-live="polite">
            {busy ? <Tag icon={<Spin size="small" />}>处理中</Tag> : null}
            {!busy && config.saved && !config.error && <Tag color="success"
              icon={<CheckCircle2 size={13} />}>已自动保存</Tag>}
          </span>
          <Button icon={<RefreshCw size={15} />} disabled={busy || editorOpen}
            onClick={() => void config.reload()}>重新读取</Button>
          <Button type="primary" icon={<CodeXml size={15} />} disabled={!document || busy}
            onClick={() => setEditorOpen(true)}>编辑 config.toml</Button>
        </div>
      </section>
      {config.error && <Alert type="error" showIcon message={document ? "配置尚未保存" : "无法读取配置"}
        description={config.error} className={styles.notice} />}
      {document?.error && <Alert type="warning" showIcon message="请先在编辑器中检查配置"
        description={document.error.message} className={styles.notice} />}
      {!config.loaded && <div className={styles.loading}><Spin tip="正在读取配置"><div /></Spin></div>}
      {document?.values && <ConfigForm key={config.reloadKey} values={document.values}
        disabled={editorOpen} onCommit={config.commit} />}
      {document && <TomlEditorModal open={editorOpen} content={document.content} revision={document.revision}
        saveError={config.error} onSave={config.saveContent} onClose={() => setEditorOpen(false)} />}
    </div>
  );
}
