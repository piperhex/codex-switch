import type { GuiToolsClient } from './guiTools';
import type { TerminalApi } from '../terminal/types';
import { readTerminal } from './terminalReader';

export function remoteTerminalApi(client: GuiToolsClient['terminal']): TerminalApi {
  const readers = new Map<string, () => void>();
  const attach: NonNullable<TerminalApi['attach']> = async (info, size, onEvent) => {
    readers.get(info.id)?.();
    const stop = readTerminal({ client, id: info.id, onEvent });
    readers.set(info.id, stop);
    // Resizing can fail during a reconnect; output polling keeps the attachment alive.
    void client.resize(info.id, size).catch(() => undefined);
    return { ...info, detach: () => {
      stop();
      if (readers.get(info.id) === stop) readers.delete(info.id);
    } };
  };
  const detach = (id: string) => { readers.get(id)?.(); readers.delete(id); };
  return {
    async open(cwd, size, onEvent) {
      const info = await client.open(cwd, size);
      return attach(info, size, onEvent);
    },
    attach,
    detach,
    write: client.write,
    resize: client.resize,
    close: async (id) => { await client.close(id); detach(id); },
  };
}
