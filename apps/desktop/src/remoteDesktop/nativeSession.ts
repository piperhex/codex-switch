import { invoke } from '@tauri-apps/api/core';
import type { IceServer } from '../../../../shared/remote-chat/protocol';
import type { DesktopSettings, DesktopSignal } from '../../../../shared/remote-desktop/protocol';

const STATUS_INTERVAL = 2000;

function profile(settings: DesktopSettings) {
  const profiles = { auto: { width: 1920, bitrate: 6_000_000 }, smooth: { width: 854, bitrate: 1_500_000 },
    clear: { width: 1920, bitrate: 8_000_000 }, original: { width: 2560, bitrate: 12_000_000 } };
  return { ...profiles[settings.quality], fps: settings.fps === 'auto' ? 60 : settings.fps };
}

/** The WebView holds signaling handles; native capture/encoding never returns pixels through IPC. */
export class NativeDesktopSession {
  private id?: string;
  private stopped = false;
  private timer?: ReturnType<typeof setTimeout>;
  constructor(private settings: DesktopSettings, private readonly iceServers: IceServer[]) {}

  async open() {
    if (!await invoke<boolean>('remote_desktop_stream_available')) throw new Error('当前电脑暂不可用。');
    if (this.stopped) throw new Error('桌面连接已结束。');
    this.id = await invoke<string>('remote_desktop_open');
    if (this.stopped) { await this.closeNative(); throw new Error('桌面连接已结束。'); }
    const offer = await this.openStream();
    if (this.stopped) { await this.closeNative(); throw new Error('桌面连接已结束。'); }
    this.schedule();
    return { ...offer, iceServers: this.iceServers };
  }

  private async openStream() {
    try {
      return await invoke<{ sdp: string }>('remote_desktop_stream_open', { request: {
        id: this.id, profile: profile(this.settings), iceServers: this.iceServers.map(server => ({ ...server,
          urls: Array.isArray(server.urls) ? server.urls : [server.urls] })),
      } });
    } catch (error) {
      await this.closeNative();
      throw error;
    }
  }

  signal(signal: DesktopSignal) {
    return invoke<{ candidates: RTCIceCandidateInit[] }>('remote_desktop_stream_signal', {
      request: { ...signal, id: this.id },
    });
  }

  async update(settings: DesktopSettings) {
    await invoke('remote_desktop_stream_update', { id: this.id, profile: profile(settings) });
    this.settings = settings;
  }

  private schedule() {
    this.timer = setTimeout(() => { void this.refresh(); }, STATUS_INTERVAL);
  }

  private async refresh() {
    if (this.stopped) return;
    try {
      const status = await invoke<{ closed: boolean }>('remote_desktop_stream_status', { id: this.id });
      if (status.closed) this.close();
    } catch { this.close(); }
    if (!this.stopped) this.schedule();
  }

  get closed() { return this.stopped; }
  close() {
    if (this.stopped) return;
    this.stopped = true; clearTimeout(this.timer); void this.closeNative();
  }
  private async closeNative() {
    const id = this.id;
    if (!id) return;
    this.id = undefined;
    await invoke('remote_desktop_stream_close', { id }).catch(async () => {
      // Old hosts lack the stream command. The native input lease still needs explicit release.
      await invoke('remote_desktop_close', { id }).catch(() => { /* The native lease also expires. */ });
    });
  }
}
