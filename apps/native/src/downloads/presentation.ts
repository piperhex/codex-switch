import type { DownloadTask } from './types';

const KIB = 1024;
const MIB = KIB * KIB;
const GIB = MIB * KIB;
export function formatBytes(bytes: number) {
  if (bytes >= GIB) return `${(bytes / GIB).toFixed(1)} GB`;
  if (bytes >= MIB) return `${(bytes / MIB).toFixed(1)} MB`;
  return `${Math.round(bytes / KIB)} KB`;
}
export function downloadPercent(task: DownloadTask) {
  if (task.status === 'completed') return 100;
  return task.size ? Math.min(100, Math.floor(task.received / task.size * 100)) : 0;
}
export const downloadStatus: Record<DownloadTask['status'], string> = {
  queued: '等待下载', downloading: '正在下载', paused: '已暂停', completed: '已完成', failed: '下载中断',
};
export function downloadDetail(task: DownloadTask) {
  const speed = task.status === 'downloading' && task.bytesPerSecond
    ? ` · ${formatBytes(task.bytesPerSecond)}/s` : '';
  return `${formatBytes(task.received)} / ${formatBytes(task.size)}${speed}`;
}
