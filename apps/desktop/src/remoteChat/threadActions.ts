import { getGuiController } from '../pages/codexGui/session';

const THREAD_ID_LIMIT = 200;

/** Use the desktop deletion flow so remote clients share its queue, approval and active-turn guards. */
export async function deleteRemoteThread(threadId: unknown) {
  if (typeof threadId !== 'string' || !threadId.trim() || threadId.length > THREAD_ID_LIMIT) {
    throw new Error('请选择有效的对话。');
  }
  const controller = getGuiController();
  if (controller.getSnapshot().connection !== 'ready') await controller.connect({ reuseExisting: true });
  if (!await controller.deleteThread(threadId)) {
    throw new Error(controller.getSnapshot().error || '删除未完成，请稍后重试。');
  }
  return {};
}
