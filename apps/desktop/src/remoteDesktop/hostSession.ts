import type { IceServer } from '../../../../shared/remote-chat/protocol';
import type { DesktopSettings, DesktopSignal } from '../../../../shared/remote-desktop/protocol';
import { DesktopHostSession } from './session';
import { NativeDesktopSession } from './nativeSession';

/** Keep a working capture fallback for Windows installations without a supported native encoder. */
export class HostSession {
  private session: DesktopHostSession | NativeDesktopSession;
  private stopped = false;
  constructor(private settings: DesktopSettings, private readonly iceServers: IceServer[]) {
    this.session = new NativeDesktopSession(settings, iceServers);
  }
  async open() {
    try { return await this.session.open(); }
    catch {
      this.session.close();
      if (this.stopped) throw new Error('桌面连接已结束。');
      this.session = new DesktopHostSession(this.settings, this.iceServers);
      return this.session.open();
    }
  }
  signal(signal: DesktopSignal) { return this.session.signal(signal); }
  async update(settings: DesktopSettings) { await this.session.update(settings); this.settings = settings; }
  get closed() { return this.stopped || this.session.closed; }
  close() { this.stopped = true; this.session.close(); }
}
