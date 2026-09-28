import { invoke } from '@tauri-apps/api/core';
import type { LocalDesktopClipboard } from '../../../../shared/remote-desktop/clipboard';

/** Native file clipboard entries remain available for pasting into Explorer after closing the viewer. */
export const localDesktopClipboard: LocalDesktopClipboard = {
  files: true,
  read: () => invoke('remote_desktop_read_local_clipboard'),
  write: content => invoke('remote_desktop_write_local_clipboard', { content }),
};
