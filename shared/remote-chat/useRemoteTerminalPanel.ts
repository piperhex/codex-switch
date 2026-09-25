import { useEffect, useRef, useState } from 'react';
import type { GuiToolsClient } from './guiTools';
import type { TerminalInfo } from '../terminal/types';

const INITIAL_SIZE = { cols: 80, rows: 24 };
export const MAX_REMOTE_TERMINALS = 8;
interface Tab { id: string; cwd: string; session: TerminalInfo }
const asTab = (session: TerminalInfo): Tab => ({ id: session.id, cwd: session.cwd, session });

/** Both phone clients discover the PC's shells instead of storing connection-specific handles. */
export function useRemoteTerminalPanel(options: {
  client: GuiToolsClient['terminal']; cwd: string; connected: boolean;
}) {
  const { client, cwd, connected } = options;
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [selected, setSelected] = useState('');
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const pending = useRef(false);
  const generation = useRef(0);
  useEffect(() => () => { generation.current += 1; }, [client]);

  const run = async (action: (current: () => boolean) => Promise<void>) => {
    if (pending.current) return;
    if (!connected) { setError('请先连接电脑，再试一次。'); return; }
    pending.current = true; setBusy(true); setError('');
    const version = ++generation.current;
    const current = () => version === generation.current;
    try { await action(current); }
    catch { if (current()) setError('终端暂时无法连接，请确认电脑在线后重试。'); }
    finally { pending.current = false; if (current()) setBusy(false); }
  };
  const restore = (sessions: TerminalInfo[]) => {
    setTabs(previous => sessions.map(session => previous.find(tab => tab.id === session.id) ?? asTab(session)));
    setSelected(previous => sessions.some(session => session.id === previous) ? previous : sessions.at(-1)?.id ?? '');
  };
  useEffect(() => {
    if (!connected) return;
    let cancelled = false;
    const version = generation.current;
    void client.list().then(sessions => {
      if (!cancelled && !pending.current && version === generation.current) { restore(sessions); setError(''); }
    }).catch(() => {
      if (!cancelled) setError('无法读取电脑上的终端，请稍后重试。');
    });
    return () => { cancelled = true; };
  }, [client, connected]);

  const create = async () => {
    const version = generation.current;
    const session = await client.open(cwd, INITIAL_SIZE);
    // A late open still belongs to the PC even if this screen has gone away.
    if (version !== generation.current) return;
    setTabs(previous => [...previous.filter(tab => tab.id !== session.id), asTab(session)]);
    setSelected(session.id); setOpen(true);
  };
  const add = () => { void run(async current => {
    const sessions = await client.list();
    if (!current()) return;
    restore(sessions);
    if (sessions.length >= MAX_REMOTE_TERMINALS) { setError('终端较多，请先关闭一个再试。'); return; }
    await create();
  }); };
  const toggle = () => {
    if (open) { setOpen(false); return; }
    if (tabs.length) { setOpen(true); return; }
    void run(async current => {
      const sessions = await client.list();
      if (!current()) return;
      restore(sessions);
      if (sessions.length) setOpen(true);
      else await create();
    });
  };
  const remove = (id: string) => { void run(async current => {
    await client.close(id);
    if (!current()) return;
    const remaining = tabs.filter(tab => tab.id !== id);
    setTabs(remaining);
    setSelected(previous => previous === id ? remaining.at(-1)?.id ?? '' : previous);
    if (!remaining.length) setOpen(false);
  }); };
  return { tabs, selected, open, busy, error, add, remove, toggle, select: setSelected, hide: () => setOpen(false) };
}
