import { useEffect } from 'react';
import { ChatHost } from './host';
import { retainGuiSession } from '../pages/codexGui/session';
import { mobileConnection } from './mobileConnection';
import { invoke } from '@tauri-apps/api/core';

const HOST_HEARTBEAT_MS = 10_000;

export function useChatHost() {
  useEffect(() => {
    const releaseSession = retainGuiSession();
    const host = new ChatHost(mobileConnection.setConnected);
    let pending = false;
    let active = true;
    const heartbeat = async () => {
      if (pending || !active) return;
      pending = true;
      try { await invoke('remote_chat_host_alive', { active: mobileConnection.getSnapshot() }); }
      catch { console.warn('Chat host health check unavailable.'); }
      finally { pending = false; }
    };
    const timer = setInterval(() => { void heartbeat(); }, HOST_HEARTBEAT_MS);
    void heartbeat();
    return () => {
      active = false; clearInterval(timer); host.close(); releaseSession();
      void invoke('remote_chat_host_alive', { active: false }).catch(() => {
        // During process shutdown the host no longer exists, so the lease cannot be explicitly cleared.
      });
    };
  }, []);
}

export function RemoteChatHost() { useChatHost(); return null; }
