import type { IceServer } from '../../../../shared/remote-chat/protocol';
import { DesktopAdaptation, type NetworkSample } from '../../../../shared/remote-desktop/adaptation';
import type { DesktopSettings, DesktopSignal } from '../../../../shared/remote-desktop/protocol';
import { DesktopCapture } from './capture';
import { DesktopControls } from './controls';

const HEARTBEAT_TIMEOUT = 12_000;
const SETUP_TIMEOUT = 30_000;
const STATS_INTERVAL = 2000;
const MAX_CANDIDATES = 128;

export class DesktopHostSession {
  private readonly pc: RTCPeerConnection;
  private readonly capture = new DesktopCapture();
  private readonly adaptation = new DesktopAdaptation();
  private readonly controls = new DesktopControls(this.capture, () => this.fail());
  private readonly channel: RTCDataChannel;
  private sender?: RTCRtpSender;
  private candidates: RTCIceCandidateInit[] = [];
  private receivedCandidates = 0;
  private stopped = false;
  private timer?: ReturnType<typeof setTimeout>;
  private expires: ReturnType<typeof setTimeout>;
  private lastStats = 0;
  private frames = 0;
  private settings: DesktopSettings;

  constructor(settings: DesktopSettings, private readonly iceServers: IceServer[]) {
    this.settings = settings;
    this.pc = new RTCPeerConnection({ iceServers });
    this.channel = this.pc.createDataChannel('remote-desktop-controls', { ordered: true });
    this.expires = setTimeout(() => this.close(), SETUP_TIMEOUT);
    this.bind();
  }

  private bind() {
    this.pc.addEventListener('icecandidate', ({ candidate }) => {
      if (candidate && this.candidates.length < MAX_CANDIDATES) this.candidates.push(candidate.toJSON());
    });
    this.pc.addEventListener('connectionstatechange', () => {
      if (['failed', 'closed'].includes(this.pc.connectionState)) this.close();
    });
    this.channel.addEventListener('close', () => this.close());
    this.channel.addEventListener('message', ({ data }) => {
      if (this.stopped || typeof data !== 'string' || data.length > 8192) { this.fail(); return; }
      if (data === '{"kind":"ping"}') {
        clearTimeout(this.expires); this.expires = setTimeout(() => this.close(), HEARTBEAT_TIMEOUT); return;
      }
      try { this.controls.receive(data); } catch { this.fail(); }
    });
  }

  async open() {
    const stream = await this.capture.open(this.adaptation.profile(this.settings).width);
    if (this.stopped) throw new Error('桌面连接已结束。');
    this.sender = this.pc.addTrack(stream.getVideoTracks()[0], stream);
    // Android's bundled decoder factory offers native H.264 hardware decoding with native software fallback.
    const codecs = RTCRtpSender.getCapabilities('video')?.codecs;
    const transceiver = this.pc.getTransceivers().find(item => item.sender === this.sender);
    if (codecs && transceiver?.setCodecPreferences) {
      transceiver.setCodecPreferences([...codecs.filter(codec => codec.mimeType === 'video/H264'),
        ...codecs.filter(codec => codec.mimeType !== 'video/H264')]);
    }
    const offer = await this.pc.createOffer();
    if (this.stopped) throw new Error('桌面连接已结束。');
    await this.pc.setLocalDescription(offer);
    this.lastStats = performance.now();
    void this.tick();
    return { sdp: offer.sdp ?? '', iceServers: this.iceServers };
  }

  async signal(signal: DesktopSignal) {
    if (this.stopped) throw new Error('桌面连接已结束，请重新连接。');
    if (!Array.isArray(signal.candidates) || signal.candidates.length + this.receivedCandidates > MAX_CANDIDATES) {
      throw new Error('桌面连接信息无效。');
    }
    if (signal.answer !== undefined) {
      if (typeof signal.answer !== 'string' || signal.answer.length > 64_000 || this.pc.remoteDescription) {
        throw new Error('桌面连接信息无效。');
      }
      await this.pc.setRemoteDescription({ type: 'answer', sdp: signal.answer });
    }
    for (const candidate of signal.candidates) {
      if (typeof candidate.candidate !== 'string' || candidate.candidate.length > 4096) {
        throw new Error('桌面连接信息无效。');
      }
      await this.pc.addIceCandidate(candidate); this.receivedCandidates += 1;
    }
    return { candidates: this.candidates.splice(0) };
  }

  update(settings: DesktopSettings) { this.settings = settings; }

  private async tick() {
    if (this.stopped) return;
    const started = performance.now();
    try {
      const profile = this.adaptation.profile(this.settings);
      await this.capture.frame(profile.width);
      this.frames += 1;
      if (started - this.lastStats >= STATS_INTERVAL) await this.updateStats(started);
      if (!this.stopped) this.timer = setTimeout(() => { void this.tick(); },
        Math.max(0, 1000 / profile.fps - (performance.now() - started)));
    } catch { this.fail(); }
  }

  private async updateStats(now: number) {
    const stats = await this.pc.getStats();
    if (this.stopped) return;
    const sample: NetworkSample = {};
    let encodedFps: number | undefined;
    let encodedWidth: number | undefined;
    let encodedHeight: number | undefined;
    let connection: 'direct' | 'relay' | undefined;
    stats.forEach(report => {
      if (report.type === 'candidate-pair' && report.state === 'succeeded' && report.nominated) {
        sample.bitrate = report.availableOutgoingBitrate; sample.rtt = report.currentRoundTripTime;
        connection = [report.localCandidateId, report.remoteCandidateId]
          .some(id => stats.get(id)?.candidateType === 'relay') ? 'relay' : 'direct';
      }
      if (report.type === 'remote-inbound-rtp' && report.kind === 'video') sample.loss = report.fractionLost;
      if (report.type === 'outbound-rtp' && report.kind === 'video') {
        encodedFps = report.framesPerSecond;
        encodedWidth = report.frameWidth; encodedHeight = report.frameHeight;
        sample.limited = report.qualityLimitationReason === 'bandwidth' || report.qualityLimitationReason === 'cpu';
      }
    });
    this.adaptation.sample(sample);
    const profile = this.adaptation.profile(this.settings);
    const parameters = this.sender?.getParameters();
    if (parameters?.encodings?.length) {
      parameters.encodings[0].maxBitrate = profile.bitrate;
      parameters.encodings[0].maxFramerate = profile.fps;
      await this.sender?.setParameters(parameters);
    }
    if (this.channel.readyState === 'open' && !this.stopped) {
      this.channel.send(JSON.stringify({ kind: 'stats', width: encodedWidth ?? this.capture.canvas.width,
        height: encodedHeight ?? this.capture.canvas.height,
        fps: Math.round(encodedFps ?? this.frames * 1000 / (now - this.lastStats)),
        bitrate: profile.bitrate, connection }));
    }
    this.frames = 0; this.lastStats = now;
  }

  private fail() {
    if (this.channel.readyState === 'open') {
      this.channel.send(JSON.stringify({ kind: 'error', message: '无法访问桌面，请确认电脑已解锁后重试。' }));
    }
    this.close();
  }
  get closed() { return this.stopped; }
  close() {
    if (this.stopped) return;
    this.stopped = true; clearTimeout(this.timer); clearTimeout(this.expires);
    this.controls.close(); this.channel.close(); this.pc.close(); this.capture.close();
  }
}
