import { CodexHomeScope, CodexHomeSelect, useSelectedCodexHome } from "../components/CodexHomeScope";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Alert, Button, Empty, Input, Segmented, Spin, Tag } from "antd";
import { CheckCircle2, CodeXml, RefreshCw, Search } from "lucide-react";
import { hasLocalBackend } from "../api/backend";
import { ConfigForm } from "./codexConfig/ConfigForm";
import { TomlEditorModal } from "./codexConfig/TomlEditorModal";
import { useCodexConfig } from "./codexConfig/useCodexConfig";
import styles from "./codexConfig/pageStyles.module.less";

export const CODEX_CONFIG_TOPBAR_ID = "codex-config-topbar-controls";

export function CodexConfigPage({ active, homeKey = "" }: { active: boolean; homeKey?: string }) {
  return <CodexHomeScope active={active}><CodexConfigContent active={active} key={homeKey} /></CodexHomeScope>;
}

function CodexConfigContent({ active }: { active: boolean }) {
  const homeId = useSelectedCodexHome();
  const config = useCodexConfig(active, homeId);
  const [editorOpen, setEditorOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [topbarHost, setTopbarHost] = useState<HTMLElement | null>(null);
  const document = config.document;
  const busy = config.pending > 0;
  useEffect(() => {
    setTopbarHost(active ? window.document.getElementById(CODEX_CONFIG_TOPBAR_ID) : null);
  }, [active]);
  if (!hasLocalBackend) return <Empty description="请在 Codex Switch 桌面端打开配置。" />;

  return (
    <div className={styles.page}>
      {active && topbarHost && createPortal(<div className={styles.controls}>
        <CodexHomeSelect disabled={busy || editorOpen} />
        <div className={styles.filters}>
          <Input allowClear prefix={<Search size={16} />} aria-label="搜索配置" placeholder="搜索配置名称或关键字"
            value={search} onChange={(event) => setSearch(event.target.value)} />
          <Segmented value={filter} onChange={(next) => setFilter(String(next))} options={[
            { value: "all", label: "全部配置" }, { value: "configured", label: "已配置" },
          ]} />
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
      </div>, topbarHost)}
      {config.error && <Alert type="error" showIcon message={document ? "配置尚未保存" : "无法读取配置"}
        description={config.error} className={styles.notice} />}
      {document?.error && <Alert type="warning" showIcon message="请先在编辑器中检查配置"
        description={document.error.message} className={styles.notice} />}
      {!config.loaded && <div className={styles.loading}><Spin tip="正在读取配置"><div /></Spin></div>}
      {document?.values && <ConfigForm key={config.reloadKey} values={document.values}
        disabled={editorOpen} onCommit={config.commit} view={{ search, filter, onSearchChange: setSearch }} />}
      {document && <TomlEditorModal open={editorOpen} content={document.content} revision={document.revision}
        saveError={config.error} onSave={config.saveContent} onClose={() => setEditorOpen(false)} />}
    </div>
  );
}
