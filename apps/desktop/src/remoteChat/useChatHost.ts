import { useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { ChatHost, type ChatHostConfig } from './host';
import { retainGuiSession } from '../pages/codexGui/session';

const HOST_REFRESH_MS = 10_000;

export function useChatHost() {
  useEffect(() => {
    const releaseSession = retainGuiSession();
    let stopped = false;
    let refreshing = false;
    let host: ChatHost | undefined;
    const refresh = async () => {
      if (stopped || refreshing) return;
      refreshing = true;
      try {
        const config = await invoke<ChatHostConfig | null>('remote_chat_config');
        if (stopped) return;
        if (!config) { host?.close(); host = undefined; return; }
        if (host?.alive && JSON.stringify(host.config) === JSON.stringify(config)) return;
        host?.close();
        host = new ChatHost(config);
      } catch {
        // A transient configuration refresh failure must not tear down a healthy active chat.
        if (host && !host.alive) host = undefined;
      }
      finally { refreshing = false; }
    };
    void refresh();
    const timer = window.setInterval(() => { void refresh(); }, HOST_REFRESH_MS);
    return () => { stopped = true; window.clearInterval(timer); host?.close(); releaseSession(); };
  }, []);
}

export function RemoteChatHost() { useChatHost(); return null; }
