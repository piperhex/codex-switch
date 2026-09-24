import type { GuiToolsClient } from './guiTools';
import type { TerminalApi } from '../terminal/types';

const OUTPUT_POLL_MS = 100;

export function remoteTerminalApi(client: GuiToolsClient['terminal']): TerminalApi {
  const readers = new Map<string, () => void>();
  return {
    async open(cwd, size, onEvent) {
      const info = await client.open(cwd, size);
      let closed = false;
      let timer: ReturnType<typeof setTimeout>;
      const stop = () => { closed = true; clearTimeout(timer); readers.delete(info.id); };
      readers.set(info.id, stop);
      const poll = async () => {
        try {
          const events = await client.read(info.id);
          if (closed) return;
          for (const event of events) { onEvent(event); if (event.type === 'exit') stop(); }
          if (!closed) timer = setTimeout(() => { void poll(); }, OUTPUT_POLL_MS);
        } catch {
          if (closed) return;
          stop();
          onEvent({ type: 'error', message: '远程终端连接已中断，请新建终端重试。' });
          onEvent({ type: 'exit', code: null });
          void client.close(info.id).catch(() => { /* The host also cleans up disconnected sessions. */ });
        }
      };
      void poll();
      return info;
    },
    write: client.write,
    resize: client.resize,
    close: async (id) => { readers.get(id)?.(); await client.close(id); },
  };
}
