import { terminalApi, type TerminalEvent, type TerminalSize } from '../pages/codexGui/terminal/api';

const MAX_OUTPUT_BYTES = 256 * 1024;
const MAX_READ_BYTES = 32 * 1024;
const MAX_TERMINALS = 8;
interface Session { id?: string; events: TerminalEvent[]; bytes: number; closed: boolean }

/** Terminal handles belong to one authenticated remote session, including pending opens. */
export class RemoteTerminals {
  private readonly owners = new Map<string, Set<Session>>();

  async request(body: Record<string, unknown>, owner: string) {
    if (body.operation === 'guiTerminalOpen') return this.open(body, owner);
    const session = [...(this.owners.get(owner) ?? [])].find(entry => entry.id === body.id);
    if (!session?.id) throw new Error('远程终端已关闭，请新建终端。');
    switch (body.operation) {
      case 'guiTerminalRead': return this.read(session);
      case 'guiTerminalWrite':
        if (session.closed || typeof body.data !== 'string') throw new Error('无法发送终端输入，请新建终端。');
        return terminalApi.write(session.id, body.data);
      case 'guiTerminalResize': return terminalApi.resize(session.id, body.size as TerminalSize);
      case 'guiTerminalClose':
        this.owners.get(owner)?.delete(session);
        session.closed = true;
        return terminalApi.close(session.id);
      default: throw new Error('当前版本暂不支持此终端操作。');
    }
  }

  private async open(body: Record<string, unknown>, owner: string) {
    if (typeof body.cwd !== 'string') throw new Error('请选择有效的项目目录。');
    const sessions = this.owners.get(owner) ?? new Set<Session>();
    if (sessions.size >= MAX_TERMINALS) throw new Error('终端较多，请先关闭一个再试。');
    this.owners.set(owner, sessions);
    const session: Session = { events: [], bytes: 0, closed: false };
    sessions.add(session);
    try {
      // The typed Rust command validates the directory, size and input limits off the UI thread.
      const info = await terminalApi.open(body.cwd, body.size as TerminalSize, event => this.receive(session, event));
      session.id = info.id;
      if (session.closed) await terminalApi.close(info.id);
      return info;
    } catch (error) { sessions.delete(session); throw error; }
  }

  private receive(session: Session, event: TerminalEvent) {
    if (session.closed) return;
    const bytes = event.type === 'output' ? event.data.length : 0;
    if (session.bytes + bytes > MAX_OUTPUT_BYTES) {
      session.events.push({ type: 'error', message: '终端输出过多，已停止接收。请新建终端重试。' },
        { type: 'exit', code: null });
      this.close(session);
      return;
    }
    session.events.push(event); session.bytes += bytes;
    if (event.type === 'exit') session.closed = true;
  }

  private read(session: Session) {
    const events: TerminalEvent[] = [];
    let bytes = 0;
    while (session.events.length && bytes < MAX_READ_BYTES) {
      const event = session.events.shift()!;
      events.push(event);
      if (event.type === 'output') { bytes += event.data.length; session.bytes -= event.data.length; }
    }
    return events;
  }

  private close(session: Session) {
    session.closed = true;
    if (session.id) void terminalApi.close(session.id).catch(() => console.error('Remote terminal cleanup failed'));
  }

  release(owner?: string) {
    const owners = owner === undefined ? [...this.owners.keys()] : [owner];
    for (const key of owners) {
      for (const session of this.owners.get(key) ?? []) this.close(session);
      this.owners.delete(key);
    }
  }
}
