import { invoke } from '../../api/backend';
import type { LocalProxyStatus } from '../../types';
import type { RequestSpeed } from '../../../../../shared/remote-chat/composer';
import { subscribeGuiEvent } from './webEvents';

const REFRESH_INTERVAL_MS = 5_000;
export interface RequestSpeedSource {
  read(): Promise<RequestSpeed>;
  set(speed: RequestSpeed): Promise<RequestSpeed>;
  subscribe(listener: (speed: RequestSpeed) => void): () => void;
}

/** Shares the host's proxy speed without storing it as a per-conversation preference. */
export class RequestSpeedBridge implements RequestSpeedSource {
  private value?: RequestSpeed;
  private pending?: Promise<RequestSpeed>;
  private readonly listeners = new Set<(speed: RequestSpeed) => void>();
  private stopWatching?: () => void;

  subscribe(listener: (speed: RequestSpeed) => void) {
    this.listeners.add(listener);
    if (this.listeners.size === 1) this.watch();
    return () => {
      this.listeners.delete(listener);
      if (!this.listeners.size) { this.stopWatching?.(); this.stopWatching = undefined; }
    };
  }

  private watch() {
    let stopped = false;
    let unsubscribe: (() => void) | undefined;
    const refresh = () => {
      if (stopped) return;
      // A transient status failure keeps the last confirmed mode; the next refresh retries it.
      void this.read().catch(() => undefined);
    };
    const timer = setInterval(refresh, REFRESH_INTERVAL_MS);
    void subscribeGuiEvent('providers-changed', refresh).then((stop) => {
      if (stopped) stop(); else unsubscribe = stop;
    }).catch(() => { /* Polling also supports hosts without this event. */ });
    refresh();
    this.stopWatching = () => { stopped = true; clearInterval(timer); unsubscribe?.(); };
  }

  private request(operation: () => Promise<LocalProxyStatus>) {
    // Serialize reads and writes so a slow poll cannot restore the mode preceding a phone change.
    const result = (this.pending ?? Promise.resolve()).catch(() => undefined).then(operation).then((status) => {
      const speed = status.running && status.fastModeEnabled ? 'fast' : 'normal';
      if (speed !== this.value) {
        this.value = speed;
        for (const listener of this.listeners) listener(speed);
      }
      return speed;
    });
    this.pending = result;
    const clear = () => { if (this.pending === result) this.pending = undefined; };
    void result.then(clear, clear);
    return result;
  }

  read() {
    return this.pending ?? this.request(() => invoke<LocalProxyStatus>('get_local_proxy_status'));
  }

  set(speed: RequestSpeed) {
    return this.request(async () => {
      try {
        return await invoke<LocalProxyStatus>('set_local_proxy_fast_mode', { enabled: speed === 'fast' });
      } catch {
        throw new Error('速度模式未能切换，请确认电脑端支持所选模式后重试。');
      }
    });
  }
}
