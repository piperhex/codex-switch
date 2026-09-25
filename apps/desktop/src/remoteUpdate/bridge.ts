import { getVersion } from '@tauri-apps/api/app';
import { emit, listen } from '@tauri-apps/api/event';
import { checkForUpdate, downloadAvailableUpdate, installDownloadedUpdate } from '../api/backend';
import type { UpdateAction } from '../../../../shared/desktop-update/protocol';
import { RemoteUpdateService } from './service';

interface UpdateRequest { commandId: string; action: UpdateAction; version?: string | null }

export async function startRemoteUpdateBridge() {
  const service = new RemoteUpdateService(await getVersion(), {
    check: () => checkForUpdate({ force: true, replacePending: true }),
    download: downloadAvailableUpdate,
    install: installDownloadedUpdate,
  });
  return listen<UpdateRequest>('remote-app-update-request', ({ payload }) => {
    void service.request(payload.action, payload.version)
      .then((data) => emit('remote-app-update-result', { commandId: payload.commandId, data }))
      .catch(() => emit('remote-app-update-result', {
        commandId: payload.commandId, error: '操作未完成，请稍后重试。',
      })).catch((error: unknown) => console.error('Could not report remote update status', error));
  });
}
