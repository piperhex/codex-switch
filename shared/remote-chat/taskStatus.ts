import type { ChatState, Turn } from './client/types';
import { liveChat } from './connectionHealth';
import type { TaskDelivery } from './taskDelivery';
import type { QueueMessage } from './queue';

export interface TaskStatus { label: string; detail: string; kind: 'progress' | 'confirmation' | 'issue' }

const SUBMISSION: Partial<Record<TaskDelivery['phase'], TaskStatus>> = {
  unknown: { label: '发送结果待核实',
    detail: '电脑尚未确认这条消息。请先核对聊天和待发送消息，避免重复发送。', kind: 'issue' },
  sending: { label: '正在发送', detail: '正在把消息发送到电脑。', kind: 'progress' },
  sent: { label: '已发送', detail: '等待电脑确认收到，尚不能确认 AI 已开始。', kind: 'progress' },
};
const EXECUTION: Record<string, TaskStatus | undefined> = {
  inProgress: { label: 'AI 已开始处理', detail: '可在聊天中查看最新进度。', kind: 'progress' },
  completed: { label: '结果待确认', detail: '任务已完成，请查看回复和改动。', kind: 'confirmation' },
  failed: { label: '任务未完成', detail: '请查看失败原因，再决定如何继续。', kind: 'issue' },
  interrupted: { label: '任务已停止', detail: '请查看已有结果，再决定是否继续。', kind: 'progress' },
};

function queuedStatus(queue: QueueMessage[]): TaskStatus | undefined {
  if (!queue.length) return;
  const attention = queue.some(item => item.error);
  return { label: '电脑已收到', detail: attention ? '待发送消息需要处理，请查看下方提示。'
    : '消息已保存在电脑的待发送列表中，等待 AI 处理。', kind: attention ? 'issue' : 'progress' };
}

function executionStatus(turn?: Turn, delivery?: TaskDelivery): TaskStatus | undefined {
  const users = turn?.items.filter(item => item.type === 'userMessage').length ?? 0;
  if (delivery?.phase === 'received' && turn?.id === delivery.afterTurnId && users <= (delivery.afterUserCount ?? 0)) {
    return { label: '电脑已收到', detail: '等待这条消息的处理进度，请留意聊天和待发送列表。', kind: 'progress' };
  }
  if (turn && EXECUTION[turn.status]) return EXECUTION[turn.status];
  if (delivery?.phase === 'received') return { label: '电脑已收到',
    detail: '电脑已确认收到，等待同步处理进度。', kind: 'progress' };
}

/** Submission receipts describe messages; execution state comes only from the engine/history. */
export function taskStatus(state: ChatState): TaskStatus | undefined {
  const thread = state.selected;
  if (!thread) return state.sending
    ? { label: '正在准备任务', detail: '准备完成后发送到电脑。', kind: 'progress' } : undefined;
  const delivery = state.deliveries?.[thread.id];
  const submission = delivery && SUBMISSION[delivery.phase];
  if (submission) return submission;
  const turn = thread.turns?.at(-1);
  const queue = state.queue.threads[thread.id] ?? [];
  if (!liveChat(state) && (turn?.status === 'inProgress' || queue.length || delivery?.phase === 'received')) {
    return { label: '任务状态待更新', detail: '连接已中断，显示的是上次状态；重连后核实进度。', kind: 'issue' };
  }
  if (state.approvals.some(event => event.params.threadId === thread.id)) {
    return { label: '等待你的确认', detail: '请处理下方待确认事项，任务才能继续。', kind: 'confirmation' };
  }
  return queuedStatus(queue) ?? executionStatus(turn, delivery);
}

/** Keep routine progress and approvals in the conversation; the header only shows issues. */
export function taskIssue(state: ChatState): TaskStatus | undefined {
  const status = taskStatus(state);
  return status?.kind === 'issue' ? status : undefined;
}
