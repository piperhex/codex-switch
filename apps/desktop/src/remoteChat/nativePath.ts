import { Channel as IpcChannel, invoke } from '@tauri-apps/api/core';
import { NativePath, type NativePathFactory, type NativePathEvent } from '../../../../shared/remote-chat/nativePath';

export const createDesktopNativePath: NativePathFactory = options => new NativePath(options, {
  open: (input, callback) => {
    const events = new IpcChannel<NativePathEvent>();
    events.onmessage = callback;
    return invoke<string>('remote_native_path_open', { request: { sessionId: input.sessionId }, events });
  },
  send: (id, text) => invoke('remote_native_path_send', { request: { id, text } }),
  close: id => invoke('remote_native_path_close', { id }),
  mediaOpen: (id, viewId) => invoke('remote_native_media', { request: { id, viewId, action: 'open' } }),
  mediaStatus: (id, viewId) => invoke('remote_native_media', { request: { id, viewId, action: 'status' } }),
  mediaClose: (id, viewId) => invoke('remote_native_media', { request: { id, viewId, action: 'close' } }),
});
