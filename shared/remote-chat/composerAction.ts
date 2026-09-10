export const CONTINUE_MESSAGE = '请继续完成刚才中断的任务。';

export type ComposerAction = 'send' | 'pause' | 'continue';

export function composerAction(state: { running: boolean; interrupted: boolean; hasDraft: boolean }): ComposerAction {
  if (state.running) return 'pause';
  return state.interrupted && !state.hasDraft ? 'continue' : 'send';
}

export const COMPOSER_ACTION_LABELS: Record<ComposerAction, string> = {
  send: '发送消息', pause: '暂停生成', continue: '继续生成',
};
