import { listen } from "@tauri-apps/api/event";
import { invoke, isDesktopApp } from "../../api/backend";

const POLL_INTERVAL_MS = 250;
const RETRY_INTERVAL_MS = 1500;
interface Cursor { streamId: string; sequence: number }
interface WebEvent { name: string; payload: unknown }
interface Batch { cursor: Cursor; reset: boolean; events: WebEvent[] }
type Subscriber = (payload: unknown) => void;
const subscribers = new Map<string, Set<Subscriber>>();
let cursor: Cursor | undefined;
let timer: ReturnType<typeof setTimeout> | undefined;
let pending: Promise<void> | undefined;
let interrupted = false;

function deliver(name: string, payload: unknown) {
  subscribers.get(name)?.forEach((callback) => callback(payload));
}

function connection(method: string) {
  deliver("codex-gui-event", { method, params: {} });
}

function schedule(delay = POLL_INTERVAL_MS) {
  clearTimeout(timer);
  if (subscribers.size) timer = setTimeout(() => void poll(), delay);
}

async function poll() {
  if (pending) return pending;
  let delay = POLL_INTERVAL_MS;
  pending = (async () => {
    try {
      const batch = await invoke<Batch>("codex_gui_events", { cursor });
      if (!subscribers.size) return;
      cursor = batch.cursor;
      if (batch.reset || interrupted) {
        // Re-read authoritative thread state before accepting more deltas after a gap.
        connection("connection/closed");
        connection("connection/restored");
      } else {
        batch.events.forEach((event) => deliver(event.name, event.payload));
      }
      interrupted = false;
    } catch (error) {
      if (!subscribers.size) return;
      if (!cursor) throw error;
      if (!interrupted) connection("connection/closed");
      interrupted = true;
      delay = RETRY_INTERVAL_MS;
    }
  })().finally(() => { pending = undefined; schedule(delay); });
  return pending;
}

export async function subscribeGuiEvent<T>(name: string, callback: (payload: T) => void) {
  if (isDesktopApp) return listen<T>(name, ({ payload }) => callback(payload));
  const receive: Subscriber = (payload) => callback(payload as T);
  const listeners = subscribers.get(name) ?? new Set<Subscriber>();
  listeners.add(receive);
  subscribers.set(name, listeners);
  const stop = () => {
    listeners.delete(receive);
    if (!listeners.size && subscribers.get(name) === listeners) subscribers.delete(name);
    if (!subscribers.size) { clearTimeout(timer); cursor = undefined; interrupted = false; }
  };
  try {
    // Establish the replay cursor before starting Codex so early notifications cannot be lost.
    if (!cursor) await poll();
  } catch (error) { stop(); throw error; }
  return stop;
}
