import { object, type IceServer } from '../../../../shared/remote-chat/protocol';
import { validateSettings, type DesktopSignal } from '../../../../shared/remote-desktop/protocol';
import { DesktopHostSession } from './session';

/** Owner and ICE configuration come only from the authenticated coordinator. */
export class RemoteDesktopHost {
  private peers = new Map<string, IceServer[]>();
  private active?: { owner: string; id: string; session: DesktopHostSession };
  register(owner: string, iceServers: IceServer[]) { this.peers.set(owner, iceServers); }
  async request(value: unknown, owner: string) {
    const body = object(value);
    if (typeof body.id !== 'string' || !/^[a-zA-Z0-9-]{1,100}$/.test(body.id)) {
      throw new Error('桌面连接信息无效，请重新连接。');
    }
    const iceServers = this.peers.get(owner);
    if (!iceServers) throw new Error('请先连接电脑。');
    if (body.action === 'open') return this.open({ owner, id: body.id, settings: body.settings, iceServers });
    const active = this.active;
    if (!active || active.owner !== owner || active.id !== body.id) {
      if (body.action === 'close') return;
      throw new Error('桌面连接已结束，请重新连接。');
    }
    switch (body.action) {
      case 'close': active.session.close(); this.active = undefined; return;
      case 'settings': active.session.update(validateSettings(body.settings)); return;
      case 'signal': return active.session.signal(body as unknown as DesktopSignal);
      default: throw new Error('不支持的远程桌面操作。');
    }
  }
  private async open(input: { owner: string; id: string; settings: unknown; iceServers: IceServer[] }) {
    const settings = validateSettings(input.settings);
    if (this.active && !this.active.session.closed) {
      throw new Error('已有远程桌面连接，请先关闭后再试。');
    }
    const session = new DesktopHostSession(settings, input.iceServers);
    this.active = { owner: input.owner, id: input.id, session };
    try { return await session.open(); }
    catch (error) {
      session.close();
      if (this.active?.session === session) this.active = undefined;
      if (typeof error === 'string') throw new Error(error);
      throw error;
    }
  }
  release(owner?: string) {
    if (owner === undefined) this.peers.clear(); else this.peers.delete(owner);
    if (this.active && (owner === undefined || this.active.owner === owner)) {
      this.active.session.close(); this.active = undefined;
    }
  }
}
