import { guiApi } from '../pages/codexGui/api';
import { keyPair } from '../../../../shared/remote-chat/cipher';
import { ChatLink } from '../../../../shared/remote-chat/link';
import { RtcPeer } from '../../../../shared/remote-chat/rtcPeer';
import { parseMessage, type IceServer, type Signal } from '../../../../shared/remote-chat/protocol';
import { ChatOperations } from './operations';
import { guiComposer } from '../pages/codexGui/composerBridge';
import { COMPOSER_EVENT } from '../../../../shared/remote-chat/composer';
import { SIDEBAR_EVENT } from '../../../../shared/remote-chat/sidebar';
import { guiSidebar } from '../pages/codexGui/sidebarBridge';
import { EventStream } from './eventStream';

export interface ChatHostConfig { websocketUrl: string; accessToken: string; deviceId: string }

export class ChatHost {
  private readonly socket: WebSocket;
  private readonly links = new Map<string, ChatLink>();
  private readonly operations = new ChatOperations();
  private readonly stream = new EventStream((event) => this.broadcast(event));
  private unsubscribe?: () => void;
  private readonly unsubscribeComposer: () => void;
  private readonly unsubscribeSidebar: () => void;
  private closed = false;

  constructor(readonly config: ChatHostConfig) {
    this.unsubscribeComposer = guiComposer.subscribe((snapshot) => {
      this.broadcast({ method: COMPOSER_EVENT, params: snapshot });
    });
    this.unsubscribeSidebar = guiSidebar.subscribe((snapshot) => {
      this.broadcast({ method: SIDEBAR_EVENT, params: snapshot });
    });
    this.socket = new WebSocket(config.websocketUrl);
    this.socket.onopen = () => this.send({ type: 'authenticate', role: 'desktop',
      accessToken: config.accessToken, deviceId: config.deviceId });
    this.socket.onmessage = ({ data }: MessageEvent<unknown>) => {
      if (typeof data === 'string') void this.receive(data).catch(() => this.close());
    };
    this.socket.onclose = () => this.close();
    this.socket.onerror = () => this.close();
    void guiApi.subscribe((event) => {
      guiSidebar.receive(event); this.stream.receive(this.operations.prepareEvent(event));
    }).then((unsubscribe) => {
      if (this.closed) unsubscribe();
      else this.unsubscribe = unsubscribe;
    }).catch(() => this.close());
  }

  get alive() { return !this.closed; }

  private broadcast(event: unknown) {
    for (const link of this.links.values()) void link.send({ kind: 'event', event }).catch(() => link.close());
  }

  private send(message: object) {
    if (this.socket.readyState !== WebSocket.OPEN) throw new Error('Disconnected');
    this.socket.send(JSON.stringify(message));
  }

  private async receive(data: string) {
    const message = parseMessage(data);
    const sessionId = message.sessionId;
    if (typeof sessionId !== 'string') return;
    if (message.type === 'peer-open') { this.open(sessionId, message); return; }
    const link = this.links.get(sessionId);
    if (!link) return;
    if (message.type === 'signal') await link.acceptSignal(message.payload as Signal);
    if (message.type === 'relay' && typeof message.payload === 'string') link.receive(message.payload);
    if (message.type === 'relay-ready') link.enableRelay();
    if (message.type === 'peer-close') { link.close(); this.links.delete(sessionId); }
  }

  private open(sessionId: string, message: Record<string, unknown>) {
    if (this.links.size >= 4 || this.links.has(sessionId)) return;
    const keys = keyPair((size) => crypto.getRandomValues(new Uint8Array(size)));
    const link = new ChatLink({
      sessionId, desktop: true, secret: keys.secret, publicKey: String(message.publicKey),
      iceServers: message.iceServers as IceServer[],
      createPeer: (options) => new RtcPeer(options, () => new RTCPeerConnection({ iceServers: options.iceServers })),
      signal: (frame) => this.send(frame), relayBuffered: () => this.socket.bufferedAmount,
      mode: (mode) => { if (mode === 'offline') this.drop(sessionId); },
      error: () => this.drop(sessionId),
      message: (request) => {
        if (request.kind !== 'request') return;
        void this.operations.execute(request).then((response) => {
          // A history response may include buffered fragments. Deliver those first to avoid replaying them afterward.
          this.stream.flush();
          return link.send(response);
        }).catch(() => link.close());
      },
    });
    keys.secret.fill(0);
    this.links.set(sessionId, link);
    this.send({ type: 'signal', sessionId, payload: { kind: 'key', key: keys.publicKey } });
  }

  private drop(sessionId: string) {
    const link = this.links.get(sessionId);
    this.links.delete(sessionId);
    link?.close();
    if (!this.closed && this.socket.readyState === WebSocket.OPEN) this.send({ type: 'peer-close', sessionId });
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.unsubscribe?.();
    this.unsubscribeComposer();
    this.unsubscribeSidebar();
    this.stream.close();
    for (const link of this.links.values()) link.close();
    this.links.clear();
    this.socket.close();
  }
}
