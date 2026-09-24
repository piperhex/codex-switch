import type { TerminalEvent } from '../src/pages/codexGui/terminal/api';

let version = '0.155.0';
let completedAt = 0;
const terminals = new Map<string, TerminalEvent[]>();

export function demoGuiTools(input: Record<string, unknown>) {
  if (input.operation === 'guiCliRelease') return { version: '0.156.0', size: 50_000_000 };
  if (input.operation === 'guiCliInstall') completedAt = Date.now() + 1800;
  if (input.operation === 'guiCliStatus' || input.operation === 'guiCliInstall') {
    const installing = Date.now() < completedAt;
    if (completedAt && !installing) version = '0.156.0';
    return { version, installing, error: '',
      progress: installing ? { downloaded: 25_000_000, total: 50_000_000, phase: 'downloading' } : null };
  }
  if (input.operation === 'guiReconnect') return {};
  if (input.operation === 'guiTerminalOpen') {
    const id = crypto.randomUUID();
    terminals.set(id, [{ type: 'output', data: [...new TextEncoder().encode('Remote shell ready\r\n$ ')] }]);
    return { id, cwd: input.cwd || '/remote', shell: 'Remote bash' };
  }
  const id = String(input.id);
  if (input.operation === 'guiTerminalRead') {
    const events = terminals.get(id) ?? []; terminals.set(id, []); return events;
  }
  if (input.operation === 'guiTerminalWrite') {
    terminals.get(id)?.push({ type: 'output', data: [...new TextEncoder().encode(String(input.data))] });
  }
  if (input.operation === 'guiTerminalClose') terminals.delete(id);
  return {};
}
