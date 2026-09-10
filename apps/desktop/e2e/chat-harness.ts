import { keyPair } from '../../../shared/remote-chat/cipher';
import { ChatLink } from '../../../shared/remote-chat/link';
import { RtcPeer } from '../../../shared/remote-chat/rtcPeer';
import { ChatRpc } from '../../../shared/remote-chat/rpc';
import { parseMessage, type IceServer, type RpcMessage, type Signal } from '../../../shared/remote-chat/protocol';
import { demoResponse, demoState, changeDemoSidebar } from './demo-conversation';
import { changeDemoComposer } from './demo-composer';
import { demoSkillsDelay, setDemoSkills } from './demo-skills';

const query = new URLSearchParams(location.search);
const desktop = query.get('role') === 'desktop';
const blocked = query.get('blocked') === 'true';
const keys = keyPair((size) => crypto.getRandomValues(new Uint8Array(size)));
let socket: WebSocket;
let link: ChatLink;
const events: unknown[] = [];
const modes: string[] = [];
const errors: string[] = [];
let executions = 0;
let settingsDelay = 0;
let historyDelay = 0;
let legacyHistory = false;
let heartbeats = 0;
setInterval(() => { heartbeats += 1; }, 20);
const requests = new Map<string, RpcMessage>();
const rpc = new ChatRpc({ prefix: 'browser', send: (request) => link.send(request), event: (event) => events.push(event) });
function connectSocket() {
  socket = new WebSocket(query.get('socket')!);
  socket.onopen = () => socket.send(JSON.stringify({ type: 'authenticate', role: desktop ? 'desktop' : 'mobile',
  deviceId: 'computer', publicKey: keys.publicKey }));
  socket.onmessage = receive;
  socket.onclose = () => {
    link?.close();
    // The PC stays running when a phone leaves; preserve demo history across coordinator reconnections.
    if (desktop && query.has('demo')) setTimeout(connectSocket, 200);
  };
}
connectSocket();

async function receive({ data }: MessageEvent<string>) {
  const frame = parseMessage(data);
  if (frame.type === 'registered') { document.querySelector('#status')!.textContent = 'registered'; return; }
  if (frame.type === 'paired' || frame.type === 'peer-open') {
    link = new ChatLink({ sessionId: String(frame.sessionId), desktop, secret: keys.secret,
      publicKey: desktop ? String(frame.publicKey) : undefined, iceServers: frame.iceServers as IceServer[],
      createPeer: (options) => blocked ? { offer: async () => undefined, accept: async () => undefined, close() {} }
        : new RtcPeer(options, () => new RTCPeerConnection({ iceServers: options.iceServers })),
      signal: (signal) => socket.send(JSON.stringify(signal)), relayBuffered: () => socket.bufferedAmount,
      mode: (mode) => { modes.push(mode); document.querySelector('#status')!.textContent = mode; rpc.retry(); },
      error: (message) => errors.push(message), message: (message) => {
        if (!desktop) { rpc.receive(message); return; }
        if (message.kind !== 'request') return;
        let response = requests.get(message.id);
        if (!response) {
          executions += 1;
          response = legacyHistory && (message.body as { operation?: string })?.operation === 'syncHistory'
            ? { kind: 'response', id: message.id, error: '当前手机端暂不支持此操作。' }
            : { kind: 'response', id: message.id,
              data: query.has('demo') ? structuredClone(demoResponse(message, link)) : message.body };
          requests.set(message.id, response);
        }
        const target = link;
        const isSettings = (message.body as { operation?: string } | undefined)?.operation === 'composerSet';
        const isHistory = (message.body as { operation?: string } | undefined)?.operation === 'syncHistory';
        const isSkills = (message.body as { operation?: string } | undefined)?.operation === 'skills';
        const send = () => { void target.send(response).catch((error: unknown) => errors.push(String(error))); };
        if (isSettings && settingsDelay) setTimeout(send, settingsDelay);
        else if (isHistory && historyDelay) setTimeout(send, historyDelay);
        else if (isSkills && demoSkillsDelay()) setTimeout(send, demoSkillsDelay());
        else send();
      },
    });
    if (desktop) socket.send(JSON.stringify({ type: 'signal', sessionId: frame.sessionId,
      payload: { kind: 'key', key: keys.publicKey } }));
    else await link.offer();
    return;
  }
  if (frame.type === 'signal') await link.acceptSignal(frame.payload as Signal);
  if (frame.type === 'relay-ready') link.enableRelay();
  if (frame.type === 'relay') link.receive(String(frame.payload));
  if (frame.type === 'peer-close') link.close();
}

declare global {
  interface Window {
    chatTest: { modes: string[]; errors: string[]; events: unknown[]; request: (text: string) => Promise<unknown>;
      fallback: () => void; stream: (text: string) => Promise<void>; executions: () => number; beats: () => number;
      demoState: typeof demoState; setComposer: (input: unknown) => void; setSidebar: (action: string) => void;
      setSettingsDelay: (milliseconds: number) => void; setHistoryDelay: (milliseconds: number) => void;
      setSkills: typeof setDemoSkills;
      setLegacyHistory: (enabled: boolean) => void };
  }
}
window.chatTest = { modes, errors, events, request: (text) => rpc.request('request', { text }),
  fallback: () => link.fallback(), stream: (text) => link.send({ kind: 'event', event: { text } }),
  executions: () => executions, beats: () => heartbeats, demoState,
  setComposer: (input) => { changeDemoComposer(input, link); },
  setSkills: setDemoSkills,
  setSettingsDelay: (milliseconds) => { settingsDelay = Math.max(0, Math.min(5000, milliseconds)); },
  setHistoryDelay: (milliseconds) => { historyDelay = Math.max(0, Math.min(5000, milliseconds)); },
  setLegacyHistory: (enabled) => { legacyHistory = enabled; },
  setSidebar: (action) => { changeDemoSidebar(action, link); } };
