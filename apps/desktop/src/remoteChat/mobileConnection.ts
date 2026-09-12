let connected = false;
const listeners = new Set<() => void>();

export const mobileConnection = {
  getSnapshot: () => connected,
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  },
  setConnected(value: boolean) {
    if (connected === value) return;
    connected = value;
    listeners.forEach((listener) => listener());
  },
};
