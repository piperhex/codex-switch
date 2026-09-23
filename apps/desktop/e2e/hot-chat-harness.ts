import { ChatConnection } from '../../../shared/remote-chat/client/connection';
import { ChatLink } from '../../../shared/remote-chat/link';
import { keyPair } from '../../../shared/remote-chat/cipher';
import { RtcPeer } from '../../../shared/remote-chat/rtcPeer';
import type { PeerOptions, RpcMessage, Signal } from '../../../shared/remote-chat/protocol';
import { downloadFixture, fileDownloadResponse } from './file-download-fixture';

const query = new URLSearchParams(location.search);
const desktop = query.get('role') === 'desktop';
const endpoint = query.get('socket')!;
const signalDelay = Number(query.get('signalDelay') ?? 0);
const keys = keyPair((size) => crypto.getRandomValues(new Uint8Array(size)));
const events: unknown[] = [];
const errors: string[] = [];
const modes: string[] = [];
const rtc = new Set<RTCPeerConnection>();
let blocked = query.has('relayOnly');
let dropDirect = false;
let peerCreations = 0;
let beats = 0;
let readyCount = 0;
let executions = 0;
let packets = 0;
let batches = 0;
let link: ChatLink | undefined;
let resume: { sessionId: string; resumeToken: string } | undefined;
let socket: WebSocket | undefined;
let pcReconnect: ReturnType<typeof setTimeout> | undefined;
setInterval(() => { beats += 1; }, 20);

function mode(value: string) { modes.push(value); document.querySelector('#status')!.textContent = value; }
function createPeer(options: PeerOptions) {
  if (blocked) throw new Error('Test network unavailable');
  return new RtcPeer({ ...options,
    signal: (signal) => {
      if (signalDelay) setTimeout(() => options.signal(signal), signalDelay);
      else options.signal(signal);
    },
    channel: (channel) => options.channel({
    get readyState() { return channel.readyState; },
    get bufferedAmount() { return channel.bufferedAmount; },
    send: (data) => { if (!dropDirect) channel.send(data); }, close: () => channel.close(),
    onOpen: (callback) => channel.onOpen(callback), onClose: (callback) => channel.onClose(callback),
    onMessage: (callback) => channel.onMessage((data) => {
      packets += 1; if (data.startsWith('[')) batches += 1; callback(data);
    }),
  }) }, () => {
    const peer = new RTCPeerConnection({ iceServers: options.iceServers });
    peerCreations += 1;
    rtc.add(peer);
    return peer;
  });
}

const phone = new ChatConnection({ deviceId: 'computer',
  authorize: async () => ({ baseUrl: endpoint.replace(/^ws/, 'http'), accessToken: 'test' }),
  randomBytes: (size) => crypto.getRandomValues(new Uint8Array(size)), createPeer,
  mode, error: (message) => errors.push(message), event: (event) => events.push(event),
  ready: () => { readyCount += 1; },
});

function send(frame: object) {
  if (socket?.readyState !== WebSocket.OPEN) throw new Error('Unavailable');
  socket.send(JSON.stringify(frame));
}

function reconnect() {
  clearTimeout(pcReconnect);
  const previous = socket;
  socket = undefined;
  previous?.close();
  link?.setRelayAvailable(false);
  pcReconnect = setTimeout(connectPc, 1500);
}

function connectPc() {
  const current = new WebSocket(endpoint);
  socket = current;
  current.onopen = () => send({ type: 'authenticate', role: 'desktop', deviceId: 'computer',
    transportVersion: 2, sessions: resume ? [resume] : [] });
  current.onclose = () => { if (socket === current) reconnect(); };
  current.onmessage = ({ data }) => {
    if (socket === current) void receive(JSON.parse(data)).catch((error) => errors.push(String(error)));
  };
}

async function receive(frame: Record<string, unknown>) {
  if (frame.type === 'registered') { if (!link) mode('registered'); return; }
  if (frame.type === 'peer-open') {
    resume = { sessionId: String(frame.sessionId), resumeToken: String(frame.resumeToken) };
    link = new ChatLink({ ...resume, desktop: true, secret: keys.secret, publicKey: String(frame.publicKey),
      transportVersion: 2, iceServers: [], createPeer, signal: send, relayBuffered: () => socket?.bufferedAmount ?? 0,
      reconnectRelay: reconnect, mode, error: (message) => errors.push(message), message: respond,
    });
    send({ type: 'signal', sessionId: resume.sessionId, payload: { kind: 'key', key: keys.publicKey } });
  }
  if (frame.type === 'signal') await link?.acceptSignal(frame.payload as Signal);
  if (frame.type === 'relay') link?.receive(String(frame.payload));
  if (frame.type === 'peer-offline') link?.setRelayAvailable(false);
  if (frame.type === 'resumed') link?.setRelayAvailable(true);
  if (frame.type === 'peer-close') link?.close();
}

function respond(message: RpcMessage) {
  if (message.kind !== 'request') return;
  executions += 1;
  void link?.send({ kind: 'response', id: message.id,
    data: query.has('download') ? fileDownloadResponse(message.body) : message.body });
}

if (desktop) connectPc();
else phone.start();

declare global {
  interface Window {
    hotChat: { events: unknown[]; modes: string[]; errors: string[];
      request: (text: string) => Promise<unknown>; stream: (text: string) => Promise<void>;
      blockDirect: (value: boolean) => void;
      dropDirect: (value: boolean) => void;
      stats: () => { beats: number; readyCount: number; executions: number; packets: number;
        batches: number; peerCreations: number };
      disconnect: () => void };
    hotDownload: (path: string) => Promise<{ size: number; hash: string; elapsedMs: number }>;
  }
}
window.hotChat = { events, modes, errors, request: (text) => phone.request('request', { text }),
  stream: async (text) => { await link?.send({ kind: 'event', event: { text } }); },
  blockDirect: (value) => { blocked = value; if (value) { for (const peer of rtc) peer.close(); rtc.clear(); } },
  dropDirect: (value) => { dropDirect = value; },
  stats: () => ({ beats, readyCount, executions, packets, batches, peerCreations }), disconnect: () => phone.stop() };
window.hotDownload = async (path) => {
  const started = performance.now();
  return { ...await downloadFixture(phone, path), elapsedMs: performance.now() - started };
};
