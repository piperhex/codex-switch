import { createContext, useContext, type ReactNode } from 'react';
import type { ChatController } from './client/controller';
import type { ChatState, Turn } from './client/types';
import { liveChat } from './connectionHealth';
import type { ReviewClient } from './taskReview';

interface ReviewContext {
  client: ReviewClient; threadId: string; cwd: string; ready: boolean; active: boolean;
  send: (text: string) => Promise<boolean>;
}
const Context = createContext<ReviewContext | null>(null);

export function TaskReviewProvider({ controller, state, active, children }: {
  controller: ChatController; state: ChatState; active: boolean; children: ReactNode;
}) {
  const threadId = state.selected?.id ?? '';
  const send = (text: string) => {
    if (controller.snapshot().selected?.id !== threadId) return Promise.resolve(false);
    return controller.send({ text, access: controller.snapshot().settings.access });
  };
  return <Context.Provider value={{ client: controller.guiTools.review, threadId,
    cwd: state.selected?.cwd ?? '', ready: liveChat(state), active, send }}>{children}</Context.Provider>;
}

export const useTaskReviewContext = () => useContext(Context);

export function useTaskReviewAvailable(status: Turn['status']) {
  const context = useTaskReviewContext();
  return !!context && ['completed', 'failed', 'interrupted'].includes(status);
}
