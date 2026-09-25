import { useEffect, useState, useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';
import { ChatController } from '../../../shared/remote-chat/client/controller';
import { historyDelta } from '../../../shared/remote-chat/historySync';
import type { Thread } from '../src/chat/types';
import { ChatThreads } from '../src/chat/ChatThreads';
import { ChatSidebar } from '../src/chat/ChatSidebar';
import '../src/styles.css';
import '../src/chat/chat.css';

function createController() {
  return new ChatController(events => ({
    start() { events.mode('relay'); events.ready(); }, stop() {},
    async request<T>(method: string, body?: unknown): Promise<T> {
      if (method === 'connect') return [] as T;
      const input = body as { operation: string; threadId?: string };
      if (['list', 'rename', 'archive', 'unarchive', 'delete'].includes(input.operation)) {
        const response = await fetch('/web/thread-action', { method: 'POST', body: JSON.stringify(input) });
        if (!response.ok) throw new Error('操作未完成，请稍后重试。');
        return response.json();
      }
      if (input.operation === 'syncHistory') return historyDelta({ id: input.threadId, preview: '', cwd: '/project',
        updatedAt: 1, turns: [] } as Thread) as T;
      return { data: [], nextCursor: null } as T;
    },
  }));
}

function Harness() {
  const [controller] = useState(createController);
  const [open, setOpen] = useState(true);
  const state = useSyncExternalStore(controller.subscribe, controller.snapshot);
  useEffect(() => { controller.start(); return () => controller.stop(); }, [controller]);
  return <main className="chat-page" style={{ height: '100dvh' }}>
    <output data-testid="selected">{state.selected?.id ?? 'none'}</output>
    <button type="button" onClick={() => setOpen(true)}>打开列表</button>
    <ChatSidebar desktop={window.innerWidth > 860} open={open} onClose={() => setOpen(false)}>
      <ChatThreads state={state} controller={controller} newChat={() => {}} onClose={() => {}}
        openSearch={() => {}} profile={null} />
    </ChatSidebar>
  </main>;
}

createRoot(document.getElementById('root')!).render(<Harness />);
