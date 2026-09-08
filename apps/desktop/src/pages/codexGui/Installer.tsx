import { Button, Progress } from "antd";
import { Download, ExternalLink, RefreshCw, Terminal } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { useCliInstaller } from "./useCliInstaller";
import styles from "./styles.module.less";

export function Installer({ installer, compact = false, running = false }: {
  installer: ReturnType<typeof useCliInstaller>; compact?: boolean; running?: boolean;
}) {
  const { version, release, checking, installing, progress, checked, check, install } = installer;
  const available = release && release.version !== version;
  return <div className={compact ? styles.installCompact : styles.install}>
    {!compact && <div className={styles.welcomeIcon}><Terminal size={30} /></div>}
    <h2>{version ? `Codex ${version}` : "开始使用 Codex GUI"}</h2>
    <p>{version ? "检查官方版本，让 Codex 保持更新。" : "下载 Codex 后，就能在这里开始对话、处理代码和管理任务。"}</p>
    {!compact && <p className={styles.muted}>这里的对话独立保存，不会影响官方 Codex 的聊天记录。</p>}
    <div className={styles.installActions}>
      {available && <Button type="primary" icon={<Download size={16} />} loading={installing}
        disabled={running} onClick={() => void install()}>
        {version ? "更新到" : "下载并开始"} {release.version}
      </Button>}
      {!available && <Button loading={checking || !checked} icon={<RefreshCw size={15} />}
        disabled={installing} onClick={() => void check()}>{release && version ? "已是最新版本" : "检查版本"}</Button>}
      <Button type="text" icon={<ExternalLink size={14} />}
        onClick={() => void openUrl("https://github.com/openai/codex/releases")}>官方发布页</Button>
    </div>
    {available && !installing && <small>下载约 {Math.ceil(release.size / 1024 / 1024)} MB</small>}
    {running && available && <small>当前任务完成后即可更新。</small>}
    {installing && <div className={styles.downloadProgress}>
      <Progress percent={progress ? Math.floor(progress.downloaded / Math.max(progress.total, 1) * 100) : 0}
        status="active" size="small" />
      <span>{progress?.phase === "installing" ? "正在安装，即将完成…" : "正在下载 Codex…"}</span>
    </div>}
  </div>;
}
