import type { Channel, Peer, PeerOptions, Signal } from './protocol';

function dataChannel(channel: RTCDataChannel): Channel {
  return {
    get readyState() { return channel.readyState; },
    get bufferedAmount() { return channel.bufferedAmount; },
    send: (data) => channel.send(data),
    close: () => channel.close(),
    onOpen: (callback) => channel.addEventListener('open', callback),
    onClose: (callback) => {
      channel.addEventListener('close', callback);
      channel.addEventListener('error', callback);
    },
    onMessage: (callback) => channel.addEventListener('message', (event: MessageEvent<unknown>) => {
      if (typeof event.data === 'string') callback(event.data);
    }),
  };
}

/** The browser and React Native adapter both implement the standard data-channel subset. */
export class RtcPeer implements Peer {
  private readonly pc: RTCPeerConnection;
  private readonly candidates: RTCIceCandidateInit[] = [];
  private incoming = Promise.resolve();
  private closed = false;

  constructor(private readonly options: PeerOptions, create: () => RTCPeerConnection) {
    this.pc = create();
    this.pc.addEventListener('icecandidate', ({ candidate }) => {
      if (!this.closed && candidate) options.signal({ kind: 'ice', candidate: candidate.candidate,
        sdpMid: candidate.sdpMid, sdpMLineIndex: candidate.sdpMLineIndex });
    });
    this.pc.addEventListener('datachannel', ({ channel }) => options.channel(dataChannel(channel)));
    this.pc.addEventListener('connectionstatechange', () => {
      if (!this.closed && ['failed', 'disconnected', 'closed'].includes(this.pc.connectionState)) options.disconnected();
    });
  }

  async offer() {
    this.options.channel(dataChannel(this.pc.createDataChannel('codex-chat-v1', { ordered: true })));
    const offer = await this.pc.createOffer();
    if (this.closed) return;
    await this.pc.setLocalDescription(offer);
    this.options.signal({ kind: 'sdp', type: 'offer', sdp: offer.sdp ?? '' });
  }

  accept(signal: Exclude<Signal, { kind: 'key' }>): Promise<void> {
    const result = this.incoming.then(() => this.apply(signal));
    this.incoming = result.catch(() => undefined);
    return result;
  }

  private async apply(signal: Exclude<Signal, { kind: 'key' }>) {
    if (this.closed) return;
    if (signal.kind === 'ice') {
      if (this.pc.remoteDescription) await this.pc.addIceCandidate(signal);
      else if (this.candidates.length < 128) this.candidates.push(signal);
      return;
    }
    await this.pc.setRemoteDescription({ type: signal.type, sdp: signal.sdp });
    for (const candidate of this.candidates.splice(0)) await this.pc.addIceCandidate(candidate);
    if (signal.type !== 'offer' || this.closed) return;
    const answer = await this.pc.createAnswer();
    await this.pc.setLocalDescription(answer);
    this.options.signal({ kind: 'sdp', type: 'answer', sdp: answer.sdp ?? '' });
  }

  close() {
    this.closed = true;
    this.candidates.length = 0;
    this.pc.close();
  }
}
