import { useEffect } from 'react';
import type { ChatController } from '../chat/types';
import type { AuthSession } from '../types';
import { downloadManager, downloadOwner } from './manager';

export function useDownloadConnection(options: {
  session: AuthSession; deviceId: string; deviceName: string; controller: ChatController;
}) {
  const { session, deviceId, deviceName, controller } = options;
  useEffect(() => {
    if (!deviceId) return;
    void downloadManager.initialize();
    const update = () => {
      const state = controller.snapshot();
      downloadManager.bind({ owner: downloadOwner(session), deviceId, deviceName, ready: state.ready,
        threadId: state.selected?.id, cwd: state.selected?.cwd ?? state.draftProject?.cwd,
        client: controller.downloads, files: controller.files });
    };
    update();
    const unsubscribe = controller.subscribe(update);
    return () => { unsubscribe(); downloadManager.unbind(controller.files); };
  }, [session.baseUrl, session.email, deviceId, deviceName, controller]);
}
