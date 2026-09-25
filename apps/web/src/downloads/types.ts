import type { DownloadClient, DownloadLocation } from '../../../../shared/remote-chat/downloads';
import type { FileClient } from '../../../../shared/remote-chat/fileDownload';

export interface DownloadSource extends DownloadLocation {
  owner: string; deviceId: string; deviceName: string; path: string;
}
export interface DownloadTask {
  id: string; source: DownloadSource; name: string;
  status: 'queued' | 'downloading' | 'paused' | 'completed' | 'failed';
  received: number; size: number; createdAt: number; message: string;
  revision?: string; mimeType?: string; bytesPerSecond?: number;
}
export interface DownloadConnection {
  owner: string; deviceId: string; deviceName: string; ready: boolean;
  threadId?: string; cwd?: string; client: DownloadClient; files: FileClient;
}
