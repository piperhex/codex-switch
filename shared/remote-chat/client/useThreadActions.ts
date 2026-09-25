import { useRef, useState } from 'react';
import { threadPresentation } from '../sidebar';
import type { ChatController } from './controller';
import type { ChatState, Thread } from './types';
import { threadActionReason, type ThreadAction } from './threadActions';

type View = 'menu' | 'rename' | 'delete';

export function useThreadActions(state: ChatState, controller: Pick<ChatController, 'threadActions'>) {
  const [target, setTarget] = useState<{ thread: Thread; archived: boolean } | null>(null);
  const [view, setView] = useState<View>('menu');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const open = (thread: Thread) => {
    if (inFlight.current) return;
    setTarget({ thread, archived: state.archived }); setView('menu'); setError('');
    setName(threadPresentation(thread, state.sidebar).title);
  };
  const close = () => { if (!inFlight.current) setTarget(null); };
  const changeView = (next: View) => { if (!inFlight.current) { setView(next); setError(''); } };
  const submit = async (action: ThreadAction) => {
    if (!target || inFlight.current) return;
    inFlight.current = true; setBusy(true); setError('');
    try { await controller.threadActions.run(target.thread, action, name); setTarget(null); }
    catch (failure) { setError(failure instanceof Error ? failure.message : '操作未完成，请稍后重试。'); }
    finally { inFlight.current = false; setBusy(false); }
  };
  const reason = (action: ThreadAction) => target ? threadActionReason(state, target.thread, action) : '';
  return { target, view, name, setName, error, busy, open, close, changeView, submit, reason };
}

export type ThreadActionsModel = ReturnType<typeof useThreadActions>;
