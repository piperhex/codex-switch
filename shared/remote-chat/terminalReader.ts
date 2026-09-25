import type { GuiToolsClient } from './guiTools';
import type { TerminalEvent } from '../terminal/types';

const OUTPUT_POLL_MS = 100;
const RECONNECT_POLL_MS = 1000;

/** Each attachment owns one cursor and one in-flight read; failed reads never end the shell. */
export function readTerminal(options: {
  client: GuiToolsClient['terminal']; id: string; onEvent: (event: TerminalEvent) => void;
}) {
  let stopped = false;
  let connected = true;
  let cursor = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const stop = () => { stopped = true; clearTimeout(timer); };
  const poll = async () => {
    let delay = OUTPUT_POLL_MS;
    try {
      const result = await options.client.read(options.id, cursor);
      if (stopped) return;
      if (!result.found) { options.onEvent({ type: 'exit', code: null }); stop(); return; }
      if (!connected) options.onEvent({ type: 'connection', connected: true });
      connected = true;
      if (result.truncated) options.onEvent({ type: 'reset' });
      for (const event of result.events) {
        options.onEvent(event);
        if (event.type === 'exit') stop();
      }
      cursor = result.cursor;
    } catch {
      if (stopped) return;
      if (connected) options.onEvent({ type: 'connection', connected: false });
      connected = false; delay = RECONNECT_POLL_MS;
    }
    if (!stopped) timer = setTimeout(() => { void poll(); }, delay);
  };
  void poll();
  return stop;
}
