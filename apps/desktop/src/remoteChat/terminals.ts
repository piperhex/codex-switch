import { terminalApi, type TerminalInfo, type TerminalSize } from '../pages/codexGui/terminal/api';
import { TerminalOutput } from './terminalOutput';

const MAX_TERMINALS = 8;
interface Session { info?: TerminalInfo; output: TerminalOutput; exited: boolean; legacyCursor: number }

/** PC-owned shells survive transport sessions. The native transport supplies the authenticated owner. */
export class RemoteTerminals {
  private readonly owners = new Map<string, Set<Session>>();

  async request(body: Record<string, unknown>, owner: string) {
    if (body.operation === 'guiTerminalList') {
      return [...(this.owners.get(owner) ?? [])].flatMap(session => session.info ? [session.info] : []);
    }
    if (body.operation === 'guiTerminalOpen') return this.open(body, owner);
    const session = [...(this.owners.get(owner) ?? [])].find(entry => entry.info?.id === body.id);
    if (body.operation === 'guiTerminalRead') return readOutput(session, body.cursor);
    if (!session?.info) {
      if (body.operation === 'guiTerminalClose') return;
      throw new Error('终端已关闭，请新建终端。');
    }
    switch (body.operation) {
      case 'guiTerminalWrite':
        if (session.exited || typeof body.data !== 'string') throw new Error('终端已结束，请新建终端。');
        return terminalApi.write(session.info.id, body.data);
      case 'guiTerminalResize':
        if (!session.exited) return terminalApi.resize(session.info.id, body.size as TerminalSize);
        return;
      case 'guiTerminalClose':
        await terminalApi.close(session.info.id);
        this.owners.get(owner)?.delete(session);
        if (!this.owners.get(owner)?.size) this.owners.delete(owner);
        return;
      default: throw new Error('当前版本暂不支持此终端操作。');
    }
  }

  private async open(body: Record<string, unknown>, owner: string) {
    if (typeof body.cwd !== 'string') throw new Error('请选择有效的项目目录。');
    const sessions = this.owners.get(owner) ?? new Set<Session>();
    if (sessions.size >= MAX_TERMINALS) throw new Error('终端较多，请先关闭一个再试。');
    this.owners.set(owner, sessions);
    const session: Session = { output: new TerminalOutput(), exited: false, legacyCursor: 0 };
    sessions.add(session);
    try {
      // The typed Rust command validates the directory, size and input limits off the UI thread.
      session.info = await terminalApi.open(body.cwd, body.size as TerminalSize, event => {
        session.output.push(event);
        if (event.type === 'exit') session.exited = true;
      });
      return session.info;
    } catch (error) { sessions.delete(session); throw error; }
  }
}

function readOutput(session: Session | undefined, requestedCursor: unknown) {
  const cursor = requestedCursor ?? session?.legacyCursor ?? 0;
  if (!Number.isSafeInteger(cursor) || Number(cursor) < 0) throw new Error('无法读取终端，请重新打开。');
  const result = session?.output.read(Number(cursor))
    ?? { found: false, events: [], cursor: 0, truncated: false };
  // Older phones consume arrays; cursor-aware phones can replay retained output after reconnecting.
  if (requestedCursor === undefined) {
    if (session) session.legacyCursor = result.cursor;
    return result.events;
  }
  return result;
}

// Independent of ChatHost resets, token refreshes and remote client lifetimes.
export const remoteTerminals = new RemoteTerminals();
