import { invoke } from '@tauri-apps/api/core';
import type { DesktopDisplays } from '../../../../shared/remote-desktop/protocol';

export async function openDesktopCapture(displayId?: string): Promise<DesktopDisplays & { id: string }> {
  const opened = await invoke<string | (DesktopDisplays & { id: string })>('remote_desktop_open', { displayId });
  // Keep the capture fallback usable with hosts that predate display discovery.
  return typeof opened === 'string' ? { id: opened } : opened;
}
