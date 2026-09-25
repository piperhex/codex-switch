import { useEffect, useMemo, useState, type SetStateAction } from 'react';
import type { GuiToolsClient } from './guiTools';
import type { TerminalInfo } from '../terminal/types';
import { terminalBelongsToProject, terminalProjectKey } from './terminalProject';

const INITIAL_SIZE = { cols: 80, rows: 24 };
export const MAX_REMOTE_TERMINALS = 8;
interface Tab { id: string; cwd: string; session: TerminalInfo }
interface Panel { tabs: Tab[]; selected: string; open: boolean; busy: boolean; error: string }
const EMPTY_PANEL: Panel = { tabs: [], selected: '', open: false, busy: false, error: '' };
const asTab = (session: TerminalInfo): Tab => ({ id: session.id, cwd: session.cwd, session });

/** Both phone clients discover this project's PC shells without owning their lifetime. */
export function useRemoteTerminalPanel(options: {
  client: GuiToolsClient['terminal']; cwd: string; connected: boolean;
}) {
  const { client, cwd, connected } = options;
  const project = terminalProjectKey(cwd);
  const scope = useMemo(() => ({ pending: false, generation: 0 }), [client, project]);
  const [state, setState] = useState({ ...EMPTY_PANEL, scope });
  // Drop the old project's view during render, before any terminal can attach or accept input.
  const panel = state.scope === scope ? state : EMPTY_PANEL;
  const update = (change: Partial<Panel> | ((previous: Panel) => Partial<Panel>)) => {
    setState(previous => {
      const current = previous.scope === scope ? previous : EMPTY_PANEL;
      return { ...current, ...(typeof change === 'function' ? change(current) : change), scope };
    });
  };
  useEffect(() => () => { scope.generation += 1; }, [scope]);

  const run = async (action: (current: () => boolean) => Promise<void>) => {
    if (scope.pending) return;
    if (!connected) { update({ error: '请先连接电脑，再试一次。' }); return; }
    scope.pending = true; update({ busy: true, error: '' });
    const version = ++scope.generation;
    const current = () => version === scope.generation;
    try { await action(current); }
    catch { if (current()) update({ error: '终端暂时无法连接，请确认电脑在线后重试。' }); }
    finally { scope.pending = false; if (current()) update({ busy: false }); }
  };
  // Filtering also supports PCs running the previous, unscoped list protocol.
  const list = async () => (await client.list(cwd)).filter(session => terminalBelongsToProject(session, cwd));
  const restore = (sessions: TerminalInfo[]) => update(previous => ({
    tabs: sessions.map(session => previous.tabs.find(tab => tab.id === session.id) ?? asTab(session)),
    selected: sessions.some(session => session.id === previous.selected)
      ? previous.selected : sessions.at(-1)?.id ?? '',
  }));
  useEffect(() => {
    if (!connected) return;
    let cancelled = false;
    const version = scope.generation;
    const current = () => !cancelled && !scope.pending && version === scope.generation;
    void list().then(sessions => {
      if (current()) { restore(sessions); update({ error: '' }); }
    }).catch(() => {
      if (current()) update({ error: '无法读取电脑上的终端，请稍后重试。' });
    });
    return () => { cancelled = true; };
  }, [scope, connected]);

  const create = async (current: () => boolean) => {
    const session = await client.open(cwd, INITIAL_SIZE);
    // A late open remains on its original project even after switching away.
    if (!current()) return;
    update(previous => ({ tabs: [...previous.tabs.filter(tab => tab.id !== session.id), asTab(session)],
      selected: session.id, open: true }));
  };
  const add = () => { void run(async current => {
    const sessions = await list();
    if (!current()) return;
    restore(sessions);
    if (sessions.length >= MAX_REMOTE_TERMINALS) { update({ error: '终端较多，请先关闭一个再试。' }); return; }
    await create(current);
  }); };
  const toggle = () => {
    if (panel.open) { update({ open: false }); return; }
    if (panel.tabs.length) { update({ open: true }); return; }
    void run(async current => {
      const sessions = await list();
      if (!current()) return;
      restore(sessions);
      if (sessions.length) update({ open: true });
      else await create(current);
    });
  };
  const remove = (id: string) => { void run(async current => {
    await client.close(id);
    if (!current()) return;
    update(previous => {
      const tabs = previous.tabs.filter(tab => tab.id !== id);
      return { tabs, selected: previous.selected === id ? tabs.at(-1)?.id ?? '' : previous.selected,
        open: tabs.length > 0 && previous.open };
    });
  }); };
  const select = (selected: SetStateAction<string>) => update(previous => ({
    selected: typeof selected === 'function' ? selected(previous.selected) : selected,
  }));
  return { ...panel, add, remove, toggle, select, hide: () => update({ open: false }) };
}
