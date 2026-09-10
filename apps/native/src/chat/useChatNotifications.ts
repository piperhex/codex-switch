import { useEffect, useRef } from 'react';
import { Toast } from '../components/AppToast';
import type { AuthSession } from '../types';
import type { ChatController } from './controller';
import { notifyChatCompleted } from './chatNotifications';
import { chatAccountKey, completedChatTarget, notificationId, type ChatNotificationTarget } from './notificationTarget';

export function useChatCompletionNotifications(controller: ChatController, session: AuthSession, deviceId: string) {
  const account = chatAccountKey(session);
  useEffect(() => controller.subscribeEvents((event) => {
    const target = completedChatTarget(event, { account, deviceId });
    if (!target) return;
    const state = controller.snapshot();
    const thread = state.selected?.id === target.threadId
      ? state.selected : state.threads.find((entry) => entry.id === target.threadId);
    const title = state.sidebar.threads[target.threadId]?.title || thread?.name || '点击查看对话';
    void notifyChatCompleted(target, title, event.params.turn?.status === 'failed')
      .catch(() => Toast.fail('回复已完成，但通知未能显示。'));
  }), [controller, account, deviceId]);
}

export function useOpenChatNotification({ controller, target, ready, sending, handled }: {
  controller: ChatController; target: ChatNotificationTarget | null; ready: boolean; sending: boolean;
  handled: (id: string) => void;
}) {
  const opening = useRef<string | null>(null);
  useEffect(() => {
    if (!target || !ready || sending) return;
    const id = notificationId(target);
    if (opening.current === id) return;
    opening.current = id;
    let cancelled = false;
    const known = controller.snapshot().threads.find((thread) => thread.id === target.threadId);
    // A notification can reference a chat outside the first page of the sidebar.
    const thread = known ?? { id: target.threadId, preview: '', cwd: '', updatedAt: 0 };
    void controller.select(thread).then(() => {
      if (!cancelled && controller.snapshot().ready) handled(id);
    }).finally(() => { if (opening.current === id) opening.current = null; });
    return () => { cancelled = true; opening.current = null; };
  }, [controller, target, ready, sending, handled]);
}
