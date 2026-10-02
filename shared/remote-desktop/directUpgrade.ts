import type { IceServer } from '../remote-chat/protocol';
import type { DesktopSignal, DesktopSignalReply, DesktopStats } from './protocol';
import { addIceCandidate } from '../remote-chat/iceCandidate';
import { DesktopStatsSampler } from './stats';

const RETRY_DELAYS = [5000, 15_000, 30_000, 60_000];
const PROBE_TIMEOUT = 25_000;
const SIGNAL_INTERVAL = 400;
const COMMIT_RETRY = 2000;
const MAX_CANDIDATES = 128;

/** A probe must never allocate TURN or interrupt the working media connection. */
export function directIceServers(servers: IceServer[]): IceServer[] {
  return servers.flatMap(server => {
    const urls = (Array.isArray(server.urls) ? server.urls : [server.urls])
      .filter(url => /^stuns?:/i.test(url));
    return urls.length ? [{ urls }] : [];
  });
}

export interface DirectPeer {
  pc: RTCPeerConnection; stream: MediaStream; channel: RTCDataChannel; clipboard?: RTCDataChannel;
}
interface Options {
  createPeer: (configuration: RTCConfiguration) => RTCPeerConnection;
  iceServers: IceServer[];
  signal: (signal: DesktopSignal) => Promise<DesktopSignalReply>;
  activate: (peer: DirectPeer) => void;
}
interface Probe {
  generation: number; pc: RTCPeerConnection; candidates: RTCIceCandidateInit[];
  stream?: MediaStream; channel?: RTCDataChannel; clipboard?: RTCDataChannel;
  started: number; committing: boolean;
}

/** One pending peer at most. Commit retries are idempotent: a lost reply cannot tear down a promoted peer. */
export class DesktopDirectUpgrade {
  private stopped = false;
  private route?: DesktopStats['connection'];
  private timer?: ReturnType<typeof setTimeout>;
  private probe?: Probe;
  private generation = 0;
  private attempt = 0;
  private busy = false;
  constructor(private readonly options: Options) {}

  update(stats: Partial<DesktopStats>) {
    if (stats.connection) this.route = stats.connection;
    if (!this.stopped && this.route === 'relay' && !this.timer && !this.busy && !this.probe) {
      this.schedule(() => this.start(), RETRY_DELAYS[Math.min(this.attempt, RETRY_DELAYS.length - 1)]);
    }
  }

  private schedule(run: () => Promise<void>, delay: number) {
    if (this.stopped) return;
    this.timer = setTimeout(() => { this.timer = undefined; void run(); }, delay);
  }

  private async start() {
    if (this.stopped || this.route !== 'relay') return;
    this.busy = true;
    let probe: Probe | undefined;
    try {
      const pc = this.options.createPeer({ iceServers: directIceServers(this.options.iceServers) });
      probe = { pc, generation: ++this.generation, candidates: [], started: Date.now(), committing: false };
      this.probe = probe; this.bind(probe);
      const offer = await this.signal(probe, 'start');
      if (!this.current(probe)) return;
      if (!offer.sdp || offer.generation !== probe.generation) throw new Error('Unsupported direct upgrade');
      await pc.setRemoteDescription({ type: 'offer', sdp: offer.sdp });
      const answer = await pc.createAnswer();
      if (!this.current(probe)) return;
      await pc.setLocalDescription(answer);
      await this.exchange(probe, answer.sdp);
    } catch { if (probe) await this.discard(probe); }
    finally { this.busy = false; this.update({}); }
  }

  private bind(probe: Probe) {
    const { pc } = probe;
    pc.addEventListener('icecandidate', event => {
      if (event.candidate && this.current(probe) && probe.candidates.length < MAX_CANDIDATES) {
        probe.candidates.push(event.candidate.toJSON());
      }
    });
    pc.addEventListener('track', event => {
      if (!this.current(probe)) return;
      // Do not play duplicate audio while the relay still supplies the visible stream.
      if (event.track.kind === 'audio') event.track.enabled = false;
      probe.stream ??= event.streams[0];
      if (probe.stream && !probe.stream.getTracks().some(track => track.id === event.track.id)) {
        probe.stream.addTrack(event.track);
      }
    });
    pc.addEventListener('datachannel', event => {
      if (event.channel.label === 'remote-desktop-clipboard') probe.clipboard = event.channel;
      else probe.channel = event.channel;
    });
  }

  private current(probe: Probe) { return !this.stopped && this.probe === probe; }
  private signal(probe: Probe, action: 'start' | 'signal' | 'commit' | 'cancel', answer?: string) {
    return this.options.signal({ directUpgrade: { generation: probe.generation, action }, answer,
      candidates: action === 'signal' ? probe.candidates.splice(0) : [] });
  }

  private async exchange(probe: Probe, answer?: string) {
    if (!this.current(probe)) return;
    try {
      const reply = await this.signal(probe, 'signal', answer);
      if (!this.current(probe)) return;
      for (const candidate of reply.candidates) await addIceCandidate(probe.pc, candidate);
      if (await this.ready(probe)) { await this.commit(probe); return; }
      if (Date.now() - probe.started >= PROBE_TIMEOUT || ['failed', 'closed'].includes(probe.pc.connectionState)) {
        await this.discard(probe); return;
      }
      this.schedule(() => this.exchange(probe), SIGNAL_INTERVAL);
    } catch { await this.discard(probe); }
  }

  private async ready(probe: Probe) {
    if (!probe.stream || probe.channel?.readyState !== 'open' || probe.pc.connectionState !== 'connected') return false;
    const report = await probe.pc.getStats();
    let decoded = false;
    report.forEach(value => {
      if (value.type === 'inbound-rtp' && (value.kind ?? value.mediaType) === 'video' && value.framesDecoded > 0) {
        decoded = true;
      }
    });
    return this.current(probe) && decoded && new DesktopStatsSampler().sample(report).connection === 'direct';
  }

  private async commit(probe: Probe) {
    probe.committing = true;
    try {
      const reply = await this.signal(probe, 'commit');
      if (!this.current(probe)) return;
      if (!reply.committed || reply.generation !== probe.generation) {
        probe.committing = false; await this.discard(probe); return;
      }
      this.probe = undefined; this.route = 'direct'; this.attempt = 0;
      this.options.activate({ pc: probe.pc, stream: probe.stream!, channel: probe.channel!,
        clipboard: probe.clipboard });
    } catch {
      // The host may have committed already. Keep both peers until its acknowledgement arrives.
      this.schedule(() => this.commit(probe), COMMIT_RETRY);
    }
  }

  private async discard(probe: Probe) {
    if (this.probe !== probe || probe.committing) return;
    probe.pc.close();
    try { await this.signal(probe, 'cancel'); } catch { /* Host also expires abandoned probes. */ }
    if (this.probe !== probe) return;
    this.probe = undefined; this.attempt++;
    this.update({});
  }

  close() {
    this.stopped = true; clearTimeout(this.timer); this.timer = undefined;
    this.probe?.pc.close(); this.probe = undefined;
  }
}
