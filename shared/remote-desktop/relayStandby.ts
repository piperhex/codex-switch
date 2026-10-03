import type { IceServer } from '../remote-chat/protocol';
import type { DesktopSignal, DesktopSignalReply } from './protocol';
import type { DirectPeer } from './directUpgrade';
import { addIceCandidate } from '../remote-chat/iceCandidate';
import { relayIceServers, STANDBY_ACTIVE, STANDBY_ACTIVATE, STANDBY_PING, STANDBY_PONG } from './standbyProtocol';

const HEARTBEAT_MS = 2000;
const HEALTH_TIMEOUT_MS = 6000;
const PROBE_TIMEOUT_MS = 25_000;
const SIGNAL_INTERVAL_MS = 400;
const RETRY_MS = 5000;
const MAX_CANDIDATES = 128;
interface Options {
  iceServers: IceServer[];
  createPeer: (configuration: RTCConfiguration) => RTCPeerConnection;
  signal: (signal: DesktopSignal) => Promise<DesktopSignalReply>;
  activate: (peer: DirectPeer) => void;
  failed: () => void;
}
interface Probe {
  pc: RTCPeerConnection; generation: number; started: number; candidates: RTCIceCandidateInit[];
  stream?: MediaStream; channel?: RTCDataChannel; clipboard?: RTCDataChannel;
}

/** Keeps an independently relayed control channel alive without duplicating the desktop video. */
export class DesktopRelayStandby {
  private peer?: DirectPeer;
  private probe?: Probe;
  private stopped = false;
  private active = false;
  private direct = false;
  private switching = false;
  private lastPong = 0;
  private retainedAt = 0;
  private generation = 0;
  private retryAt = 0;
  private busy = false;
  private timer?: ReturnType<typeof setTimeout>;
  private readonly heartbeat: ReturnType<typeof setInterval>;
  constructor(private readonly options: Options) {
    this.heartbeat = setInterval(() => this.tick(), HEARTBEAT_MS);
  }

  update(direct: boolean) {
    const changed = this.direct !== direct;
    this.direct = direct;
    if (changed) this.tick();
  }

  retain(peer: DirectPeer) {
    if (this.stopped) { peer.pc.close(); return; }
    const previous = this.peer;
    this.peer = peer; this.active = false; this.switching = false;
    this.lastPong = 0; this.retainedAt = Date.now();
    peer.stream.getAudioTracks().forEach(track => { track.enabled = false; });
    if (previous && previous.pc !== peer.pc) previous.pc.close();
    this.cancelProbe();
    peer.channel.addEventListener('message', event => {
      if (this.stopped || this.peer !== peer) return;
      if (event.data === STANDBY_PONG) this.lastPong = Date.now();
      if (event.data === STANDBY_ACTIVE && !this.active) {
        this.active = true; this.switching = false; this.direct = false;
        this.options.activate(peer);
      }
    });
    this.send(STANDBY_PING);
  }

  fallback() {
    if (!this.usable() || this.active) return false;
    this.switching = true;
    return this.send(STANDBY_ACTIVATE);
  }

  private usable() {
    return this.peer?.pc.connectionState === 'connected' && this.peer.channel.readyState === 'open'
      && Date.now() - Math.max(this.lastPong, this.retainedAt) < HEALTH_TIMEOUT_MS;
  }

  private send(text: string) {
    try {
      if (this.peer?.channel.readyState !== 'open') return false;
      this.peer.channel.send(text); return true;
    } catch { return false; }
  }

  private tick() {
    if (this.stopped || this.active) return;
    if (this.peer && !this.usable()) {
      this.peer.pc.close(); this.peer = undefined;
      if (this.switching) { this.switching = false; this.options.failed(); return; }
    }
    if (this.peer) this.send(this.switching ? STANDBY_ACTIVATE : STANDBY_PING);
    else if (this.direct && !this.probe && !this.busy && Date.now() >= this.retryAt) void this.start();
  }

  private async start() {
    const iceServers = relayIceServers(this.options.iceServers);
    if (!iceServers.length) return;
    this.busy = true;
    this.retryAt = Date.now() + RETRY_MS;
    let probe: Probe | undefined;
    try {
      const pc = this.options.createPeer({ iceServers, iceTransportPolicy: 'relay' });
      probe = { pc, generation: ++this.generation, started: Date.now(), candidates: [] };
      this.probe = probe; this.bind(probe);
      const offer = await this.signal(probe, 'start');
      if (!this.current(probe)) return;
      if (!offer.sdp || offer.generation !== probe.generation) throw new Error('Invalid relay offer');
      await pc.setRemoteDescription({ type: 'offer', sdp: offer.sdp });
      const answer = await pc.createAnswer();
      if (!this.current(probe)) return;
      await pc.setLocalDescription(answer);
      await this.exchange(probe, answer.sdp);
    } catch { if (probe) this.discard(probe); }
    finally { this.busy = false; }
  }

  private bind(probe: Probe) {
    probe.pc.addEventListener('icecandidate', event => {
      if (this.current(probe) && event.candidate && probe.candidates.length < MAX_CANDIDATES) {
        probe.candidates.push(event.candidate.toJSON());
      }
    });
    probe.pc.addEventListener('track', event => {
      if (!this.current(probe)) return;
      if (event.track.kind === 'audio') event.track.enabled = false;
      probe.stream ??= event.streams[0];
      if (probe.stream && !probe.stream.getTracks().some(track => track.id === event.track.id)) {
        probe.stream.addTrack(event.track);
      }
    });
    probe.pc.addEventListener('datachannel', event => {
      if (event.channel.label === 'remote-desktop-clipboard') probe.clipboard = event.channel;
      else probe.channel = event.channel;
    });
  }

  private current(probe: Probe) { return !this.stopped && this.probe === probe; }
  private signal(probe: Probe, action: 'start' | 'signal' | 'commit' | 'cancel', answer?: string) {
    return this.options.signal({ relayStandby: { generation: probe.generation, action }, answer,
      candidates: action === 'signal' ? probe.candidates.splice(0) : [] });
  }

  private async exchange(probe: Probe, answer?: string) {
    if (!this.current(probe)) return;
    try {
      const reply = await this.signal(probe, 'signal', answer);
      if (!this.current(probe)) return;
      for (const candidate of reply.candidates) await addIceCandidate(probe.pc, candidate);
      if (probe.pc.connectionState === 'connected' && probe.channel?.readyState === 'open' && probe.stream) {
        const committed = await this.signal(probe, 'commit');
        if (!this.current(probe)) return;
        if (!committed.committed) throw new Error('Relay unavailable');
        this.probe = undefined;
        this.retain({ pc: probe.pc, stream: probe.stream, channel: probe.channel, clipboard: probe.clipboard });
        return;
      }
      if (Date.now() - probe.started >= PROBE_TIMEOUT_MS || ['failed', 'closed'].includes(probe.pc.connectionState)) {
        this.discard(probe); return;
      }
      this.timer = setTimeout(() => { this.timer = undefined; void this.exchange(probe); }, SIGNAL_INTERVAL_MS);
    } catch { this.discard(probe); }
  }

  private discard(probe: Probe) {
    if (this.probe !== probe) return;
    this.probe = undefined; probe.pc.close(); this.retryAt = Date.now() + RETRY_MS;
    void this.signal(probe, 'cancel').catch(() => { /* Host expires abandoned relay probes. */ });
  }
  private cancelProbe() {
    clearTimeout(this.timer); this.timer = undefined;
    if (this.probe) this.discard(this.probe);
  }
  close() {
    this.stopped = true; clearInterval(this.heartbeat); this.cancelProbe();
    this.peer?.pc.close(); this.peer = undefined;
  }
}
