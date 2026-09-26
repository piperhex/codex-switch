import type { DesktopClient, DesktopInput, DesktopSettings, DesktopStats } from './protocol';
import { sendDesktopInput } from './input';

interface ReceiverOptions {
  client: DesktopClient;
  createPeer: (configuration: RTCConfiguration) => RTCPeerConnection;
  stream: (stream: MediaStream | undefined) => void;
  status: (status: string) => void;
  stats: (stats: DesktopStats) => void;
}
const SIGNAL_INTERVAL = 400;
const HEARTBEAT_INTERVAL = 2000;
const CONNECT_TIMEOUT = 25_000;

/** Only signaling and small controls cross JS. Media stays in each platform's WebRTC engine. */
export class DesktopReceiver {
  private readonly id = `desktop-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  private pc?: RTCPeerConnection;
  private channel?: RTCDataChannel;
  private candidates: RTCIceCandidateInit[] = [];
  private stopped = false;
  private poll?: ReturnType<typeof setTimeout>;
  private heartbeat?: ReturnType<typeof setInterval>;
  private timeout?: ReturnType<typeof setTimeout>;
  constructor(private readonly options: ReceiverOptions) {}

  async start(settings: DesktopSettings) {
    this.options.status('正在连接桌面…');
    this.timeout = setTimeout(() => this.fail('桌面连接超时，请检查两端网络后重试。'), CONNECT_TIMEOUT);
    try {
      const offer = await this.options.client.open(this.id, settings);
      if (this.stopped) { await this.closeRemote(); return; }
      const pc = this.options.createPeer({ iceServers: offer.iceServers });
      this.pc = pc;
      this.bindPeer(pc);
      await pc.setRemoteDescription({ type: 'offer', sdp: offer.sdp });
      if (this.stopped) return;
      const answer = await pc.createAnswer();
      if (this.stopped) return;
      await pc.setLocalDescription(answer);
      if (!this.stopped) await this.signal(answer.sdp);
    } catch (error) {
      this.fail(error instanceof Error ? error.message : '暂时无法打开远程桌面，请重试。');
    }
  }

  private bindPeer(pc: RTCPeerConnection) {
    pc.addEventListener('icecandidate', event => {
      if (event.candidate && !this.stopped) this.candidates.push(event.candidate.toJSON());
    });
    pc.addEventListener('track', event => {
      if (!this.stopped && event.streams[0]) this.options.stream(event.streams[0]);
    });
    pc.addEventListener('datachannel', event => this.bindChannel(event.channel));
    pc.addEventListener('connectionstatechange', () => {
      if (pc.connectionState === 'connected') {
        clearTimeout(this.timeout); this.options.status('');
      } else if (['failed', 'closed'].includes(pc.connectionState) && !this.stopped) {
        this.fail('桌面连接已断开，请重新连接。');
      } else if (pc.connectionState === 'disconnected') {
        this.options.status('网络中断，正在等待恢复…');
      }
    });
  }

  private bindChannel(channel: RTCDataChannel) {
    if (this.stopped) { channel.close(); return; }
    this.channel = channel;
    channel.addEventListener('open', () => {
      if (this.stopped) return;
      const ping = () => { if (channel.readyState === 'open') channel.send('{"kind":"ping"}'); };
      ping(); this.heartbeat = setInterval(ping, HEARTBEAT_INTERVAL);
    });
    channel.addEventListener('close', () => {
      if (!this.stopped) this.fail('桌面连接已断开，请重新连接。');
    });
    channel.addEventListener('message', ({ data }) => {
      if (this.stopped || typeof data !== 'string' || data.length > 2048) return;
      try {
        const message = JSON.parse(data) as DesktopStats & { kind?: string; message?: string };
        if (message.kind === 'stats') this.options.stats(message);
        if (message.kind === 'error') this.fail(message.message || '远程操作未完成，请重试。');
      } catch { this.fail('桌面连接异常，请重新连接。'); }
    });
  }

  private async signal(answer?: string) {
    if (this.stopped) return;
    try {
      const reply = await this.options.client.signal(this.id, { answer, candidates: this.candidates.splice(0) });
      if (this.stopped) return;
      for (const candidate of reply.candidates) await this.pc?.addIceCandidate(candidate);
      // Single flight. Keep gathering late ICE candidates until connected, then stop polling.
      if (this.pc?.connectionState !== 'connected' || this.candidates.length
        || this.pc.iceGatheringState !== 'complete') {
        this.poll = setTimeout(() => { void this.signal(); }, SIGNAL_INTERVAL);
      }
    } catch { this.fail('桌面连接未能建立，请检查网络后重试。'); }
  }

  input(input: DesktopInput) { sendDesktopInput(this.channel, input); }
  async settings(settings: DesktopSettings) {
    if (!this.stopped) await this.options.client.settings(this.id, settings);
  }
  private fail(message: string) {
    if (this.stopped) return;
    this.options.stream(undefined); this.options.status(message); this.stop();
  }
  private async closeRemote() {
    try { await this.options.client.close(this.id); }
    catch { /* The host also expires disconnected sessions and releases held buttons. */ }
  }
  stop() {
    if (this.stopped) return;
    this.stopped = true;
    clearTimeout(this.poll); clearTimeout(this.timeout); clearInterval(this.heartbeat);
    this.candidates.length = 0;
    this.channel?.close(); this.pc?.close();
    void this.closeRemote();
  }
}
