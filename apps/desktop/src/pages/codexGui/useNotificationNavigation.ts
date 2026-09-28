import { useEffect, useRef, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { invoke, isDesktopApp } from '../../api/backend';
import type { GuiController } from './controller';

export interface ThreadNavigation { requestId: string; threadId: string }

/** Subscribe before draining the startup click so renderer startup cannot lose navigation. */
export function useNotificationNavigation(onOpen: () => void) {
  const [target, setTarget] = useState<ThreadNavigation>();
  const open = useRef(onOpen);
  open.current = onOpen;
  useEffect(() => {
    if (!isDesktopApp) return;
    let cancelled = false;
    let reading = false;
    let readAgain = false;
    let stop: (() => void) | undefined;
    const read = async () => {
      if (cancelled) return;
      if (reading) { readAgain = true; return; }
      reading = true;
      try {
        do {
          readAgain = false;
          const next = await invoke<ThreadNavigation | null>('codex_gui_take_notification_navigation');
          if (!cancelled && next) { setTarget(next); open.current(); }
        } while (!cancelled && readAgain);
      } catch (error) { console.error('Could not open the conversation notification', error); }
      finally { reading = false; }
    };
    void listen('codex-gui-open-thread', () => void read()).then(unlisten => {
      if (cancelled) { unlisten(); return; }
      stop = unlisten;
      void read();
    }).catch(error => console.error('Could not listen for conversation notifications', error));
    return () => { cancelled = true; stop?.(); };
  }, []);
  return target;
}

/** Wait for the local workspace connection before opening a notification's conversation. */
export function useOpenNotifiedThread(options: {
  target?: ThreadNavigation; ready: boolean;
  controller: Pick<GuiController, 'filter' | 'select'>; showConversation: () => void;
}) {
  const handled = useRef<string>();
  const showConversation = useRef(options.showConversation);
  showConversation.current = options.showConversation;
  const { target, ready, controller } = options;
  useEffect(() => {
    if (!ready || !target || handled.current === target.requestId) return;
    handled.current = target.requestId;
    showConversation.current();
    controller.filter('', false);
    void controller.select(target.threadId);
  }, [target, ready, controller]);
}
