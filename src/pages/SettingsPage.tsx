import { Button, InputNumber, Space, Switch } from "antd";
import { FolderKey, KeyRound, RefreshCw, ShieldCheck } from "lucide-react";
import { MAX_AUTO_REFRESH_SECONDS, MIN_AUTO_REFRESH_SECONDS } from "../hooks/useAutoRefresh";
import type { AppInfo } from "../types";

export function SettingsPage({ info, autoRefreshEnabled, autoRefreshSeconds, onEnabledChange, onSecondsChange }: {
  info: AppInfo | null;
  autoRefreshEnabled: boolean;
  autoRefreshSeconds: number;
  onEnabledChange: (enabled: boolean) => void;
  onSecondsChange: (value: number | string | null) => void;
}) {
  return (
    <div className="settings-page">
      <section className="settings-card">
        <div className="settings-icon"><RefreshCw size={23} /></div>
        <div><h3>用量自动刷新</h3><p>关闭后不会再定时请求用量，手动刷新仍可正常使用。</p>
          <div className="settings-field">
            <label htmlFor="auto-refresh-enabled">自动刷新</label>
            <Switch id="auto-refresh-enabled" checked={autoRefreshEnabled} checkedChildren="开" unCheckedChildren="关"
              onChange={onEnabledChange} />
            <label htmlFor="auto-refresh-interval">刷新间隔</label>
            <Space.Compact>
              <InputNumber id="auto-refresh-interval" min={MIN_AUTO_REFRESH_SECONDS} max={MAX_AUTO_REFRESH_SECONDS}
                step={1} value={autoRefreshSeconds} disabled={!autoRefreshEnabled} onChange={onSecondsChange} />
              <Button disabled>秒</Button>
            </Space.Compact>
          </div>
        </div>
      </section>
      <section className="settings-card"><div className="settings-icon"><FolderKey size={23} /></div>
        <div><h3>Codex Home</h3><p>切换账户时，管理器会原子覆盖此目录中的 auth.json。</p>
          <code>{info?.codexHome ?? "读取中…"}</code></div></section>
      <section className="settings-card"><div className="settings-icon"><KeyRound size={23} /></div>
        <div><h3>账户仓库</h3><p>每个账户的完整 auth.json 独立保存于应用数据目录。</p>
          <code>{info?.accountStore ?? "读取中…"}</code></div></section>
      <section className="settings-card note-card"><div className="settings-icon"><ShieldCheck size={23} /></div>
        <div><h3>安全说明</h3><p>前端只接收邮箱、套餐和用量摘要。访问令牌、刷新令牌不会离开 Rust 后端，也不会进入界面日志。</p></div></section>
    </div>
  );
}
