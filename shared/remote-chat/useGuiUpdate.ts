import { useState } from 'react';
import type { GuiToolsClient } from './guiTools';
import { useRemoteCliInstaller } from './useRemoteCliInstaller';

export interface GuiUpdateOptions {
  client: GuiToolsClient;
  active: boolean;
  connected: boolean;
  running: boolean;
}

/** Keep the version being confirmed fixed until the user confirms or cancels. */
export function useGuiUpdate({ client, active, connected, running }: GuiUpdateOptions) {
  const installer = useRemoteCliInstaller(client, active && connected);
  const [pending, setPending] = useState<{ client: GuiToolsClient; version: string } | null>(null);
  const confirmation = pending?.client === client ? pending.version : null;
  const available = !!installer.release && installer.release.version !== installer.version;
  const upToDate = installer.readable && !!installer.release && !available
    && !installer.checking && !installer.installing && !installer.error;
  const canCheck = active && connected && !installer.checking && !installer.installing;
  const canInstall = canCheck && installer.readable && available && !running;
  const canConfirm = canInstall && confirmation === installer.release?.version;
  const confirm = () => {
    if (!canConfirm) return;
    setPending(null);
    void installer.install();
  };
  let message = '点击“检查更新”查看是否有新版本。';
  if (available) message = '有新版本可安装。';
  if (upToDate) message = 'Codex GUI 已是最新版本。';
  if (!installer.checked) message = '正在读取版本…';
  if (installer.checking) message = '正在检查更新…';
  if (running && available && !installer.checking) message = '电脑上还有聊天任务在运行，请等任务完成后再安装。';
  if (installer.installing) message = installer.progress?.phase === 'installing'
    ? '正在安装，即将完成…' : '电脑正在下载更新…';
  if (!connected) message = '连接电脑后即可检查和安装更新。';
  const progress = installer.installing && installer.progress && installer.progress.total > 0
    ? Math.max(0, Math.min(100, Math.floor(installer.progress.downloaded / installer.progress.total * 100))) : null;
  let checkLabel = upToDate ? '已是最新' : '检查更新';
  if (installer.checking) checkLabel = '正在检查更新…';
  return { ...installer, available, checkLabel, message, progress, confirmation,
    canCheck, canInstall, canConfirm, confirm,
    requestInstall: () => {
      if (canInstall && installer.release) setPending({ client, version: installer.release.version });
    },
    cancel: () => setPending(null) };
}
