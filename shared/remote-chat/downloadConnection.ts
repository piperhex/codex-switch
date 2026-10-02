import type { ConnectionMode } from './protocol';

const CONNECTION_LABELS: Record<ConnectionMode, string> = {
  direct: 'P2P',
  relay: 'Relay',
  connecting: '正在连接…',
  offline: '未连接',
};

export function downloadConnectionLabel(mode: ConnectionMode = 'offline') {
  return CONNECTION_LABELS[mode];
}
