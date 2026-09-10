import type { ChatState } from './types';

export function compactUnavailableReason(state: ChatState): string | null {
  if (!state.ready) return '连接后即可压缩';
  if (!state.selected) return '开始对话后即可压缩';
  if (state.selectedArchived) return '恢复对话后即可压缩';
  if (state.compacting) return '正在压缩上下文…';
  if (state.sending || state.settingsBusy || state.selected.turns?.some((turn) => turn.status === 'inProgress')
    || state.approvals.some((event) => event.params.threadId === state.selected?.id)) return '请等待当前任务结束';
  return null;
}
