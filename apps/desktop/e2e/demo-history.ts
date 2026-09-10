import type { Thread } from '../src/pages/codexGui/types';

export function seedDemoHistory(thread: Thread) {
  thread.turns = [{ id: 'history', status: 'completed', items: Array.from({ length: 35 }, (_, index) => ({
    id: `history-${index + 1}`, type: index % 2 ? 'agentMessage' : 'userMessage',
    text: `历史消息 ${index + 1}\n\n这是一条用于验证分页和阅读位置的聊天记录。`,
  })) }];
}
