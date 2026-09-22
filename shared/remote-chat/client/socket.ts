/** A signalling socket can be owned by the browser or by a native credential broker. */
export interface ChatSocket {
  readonly readyState: number;
  readonly bufferedAmount: number;
  onopen: (() => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: ((event: { code: number }) => void) | null;
  onerror: (() => void) | null;
  send(data: string): void;
  close(): void;
}

export function browserChatSocket(url: string): ChatSocket {
  const socket = new WebSocket(url);
  const bridge: ChatSocket = {
    get readyState() { return socket.readyState; },
    get bufferedAmount() { return socket.bufferedAmount; },
    onopen: null, onmessage: null, onclose: null, onerror: null,
    send: (data) => socket.send(data), close: () => socket.close(),
  };
  socket.onopen = () => bridge.onopen?.();
  socket.onmessage = (event) => bridge.onmessage?.(event);
  socket.onclose = (event) => bridge.onclose?.(event);
  socket.onerror = () => bridge.onerror?.();
  return bridge;
}
