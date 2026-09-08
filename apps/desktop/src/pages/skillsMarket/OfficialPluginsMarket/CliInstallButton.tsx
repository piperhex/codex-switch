import { Button, Popover, Progress } from "antd";
import { Download } from "lucide-react";
import type { useCliInstaller } from "../../codexGui/useCliInstaller";

export function CliInstallButton({ installer }: { installer: ReturnType<typeof useCliInstaller> }) {
  const { checked, version, release, checking, installing, progress, install, check } = installer;
  if (version) return null;
  const percent = progress ? Math.floor(progress.downloaded / Math.max(progress.total, 1) * 100) : 0;
  const content = <div style={{ maxWidth: 360 }}>
    <p>安装 Codex 后，即可浏览和管理官方插件。</p>
    {release && !installing && <span>版本 {release.version} · 约 {Math.ceil(release.size / 1024 / 1024)} MB</span>}
    {installing && <Progress percent={percent} size="small" status="active" />}
  </div>;
  return <Popover content={content} overlayStyle={{ maxWidth: 400 }}>
    <Button icon={<Download size={16} />} loading={!checked || checking || installing}
      onClick={() => void (release ? install() : check())}>
      {installing ? "正在安装 Codex" : "安装 Codex"}
    </Button>
  </Popover>;
}
