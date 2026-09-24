import { invoke } from '../api/backend';
import { guiApi } from '../pages/codexGui/api';
import { getGuiController } from '../pages/codexGui/session';
import { subscribeGuiEvent } from '../pages/codexGui/webEvents';
import type { CliProgress, CliRelease, RemoteCliStatus } from '../../../../shared/remote-chat/guiTools';

// A download continues when its requesting computer disconnects and is visible after reconnecting.
let installing = false;
let progress: CliProgress | null = null;
let installError = '';

function requireIdle() {
  const state = getGuiController().getSnapshot();
  if (state.sending || state.workspaceBusy || state.approvals.length
    || Object.values(state.conversations).some(conversation => conversation.activeTurn)) {
    throw new Error('远程电脑上还有任务在运行，请等任务完成后再试。');
  }
}

async function status(): Promise<RemoteCliStatus> {
  const { version } = await invoke<{ version: string | null }>('codex_gui_cli_status');
  return { version, installing, progress, error: installError };
}

async function install(version: string) {
  let unsubscribe: (() => void) | undefined;
  try {
    unsubscribe = await subscribeGuiEvent<CliProgress>('codex-gui-download', value => { progress = value; });
    await invoke('codex_gui_cli_install', { version });
    // If another task started during the download, connect keeps its running server alive.
    await guiApi.connect();
  } catch { installError = '远程 Codex 更新未完成，请稍后重试。'; }
  finally { unsubscribe?.(); installing = false; }
}

export async function guiToolRequest(body: Record<string, unknown>) {
  switch (body.operation) {
    case 'guiCliStatus': return status();
    case 'guiCliRelease': return invoke<CliRelease>('codex_gui_cli_release');
    case 'guiCliInstall': {
      if (installing) throw new Error('远程 Codex 正在更新，请稍候。');
      if (typeof body.version !== 'string' || !/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(body.version)) {
        throw new Error('版本信息无效，请重新检查版本。');
      }
      requireIdle();
      installing = true; progress = null; installError = '';
      void install(body.version);
      return status();
    }
    case 'guiReconnect':
      if (installing) throw new Error('远程 Codex 正在更新，请稍候。');
      requireIdle();
      await guiApi.connect();
      return;
    default: throw new Error('请更新远程电脑上的 Codex Switch 后重试。');
  }
}
