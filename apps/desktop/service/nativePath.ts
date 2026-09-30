import { NativePath, type NativePathEvent, type NativePathFactory } from '../../../shared/remote-chat/nativePath';
import { invoke } from './rpc';

async function call<T>(request: object): Promise<T> {
  const response = await invoke<{ data: T; error?: string }>('service_native_path', { request });
  if (response.error) throw new Error('Direct connection unavailable');
  return response.data;
}

export const createServiceNativePath: NativePathFactory = options => {
  let stopped = false;
  return new NativePath(options, {
    open: async (input, receive) => {
      const id = await call<string>({ operation: 'open', config: {
        ...input.config, sessionId: input.sessionId, desktop: true,
      } });
      const poll = async () => {
        while (!stopped) {
          const event = await call<NativePathEvent | null>({ operation: 'poll', id, wait_ms: 0 });
          if (stopped) return;
          if (event) receive(event);
          if (event?.type === 'closed') return;
          if (!event) await new Promise(resolve => setTimeout(resolve, 25));
        }
      };
      void poll().catch(() => { if (!stopped) receive({ type: 'closed' }); });
      return id;
    },
    send: (id, text) => call<void>({ operation: 'send', id, text }),
    renew: (id, expiresAt) => call<void>({ operation: 'renew', id, expires_at: expiresAt }),
    close: id => { stopped = true; return call<void>({ operation: 'close', id }); },
  });
};
