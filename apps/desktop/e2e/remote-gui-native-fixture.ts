import type { Channel } from '@tauri-apps/api/core';
import previewImage from '../src-tauri/icons/32x32.png?inline';

const endpoint = new URLSearchParams(location.search).get('socket')!;
const sockets = new Map<string, WebSocket>();
const commands: string[] = [];
const devices = [
  { deviceId: 'computer-one', name: 'Office PC', platform: 'windows', online: true },
  { deviceId: 'computer-two', name: 'Home PC', platform: 'macos', online: true },
  { deviceId: 'offline', name: 'Offline PC', platform: 'linux', online: false },
];
let callbackId = 0;
let beats = 0;
let holdDirectory = false;
let clipboardImages: { mimeType: string; data: string }[] = [];
let holdClipboard = false;
const pendingClipboard: (() => void)[] = [];
const pendingDirectories: (() => void)[] = [];
setInterval(() => { beats++; }, 20);

type Batch = { sequence: number; events: ({ type: 'message'; data: string } | { type: 'closed'; code: number })[] };
type NativeArgs = { request: { clientId: string; deviceId: string; publicKey: string; message: object };
  events: Channel<Batch> };

async function invoke(command: string, args: NativeArgs) {
  commands.push(command);
  if (command === 'get_dream_skin_status') return { installed: true, session: 'running', activeThemeId: 'fixture',
    activeThemeAppearance: 'light', activeThemeOverlayOpacity: 0.85 };
  if (command === 'get_dream_skin_theme_preview') return previewImage;
  if (command === 'codex_gui_remote_clipboard_images') {
    if (holdClipboard) await new Promise<void>(resolve => pendingClipboard.push(resolve));
    return clipboardImages;
  }
  if (command === 'codex_gui_devices') {
    if (holdDirectory) await new Promise<void>(resolve => pendingDirectories.push(resolve));
    return { currentDeviceId: 'this-computer', identity: { baseUrl: 'https://fixture.test', userId: 'owner' }, devices };
  }
  if (command === 'gui_remote_open') {
    const socket = new WebSocket(endpoint);
    sockets.set(args.request.clientId, socket);
    let sequence = 0;
    socket.onopen = () => socket.send(JSON.stringify({ type: 'authenticate', role: 'mobile',
      deviceId: args.request.deviceId, publicKey: args.request.publicKey }));
    socket.onmessage = event => args.events.onmessage({ sequence: ++sequence,
      events: [{ type: 'message', data: String(event.data) }] });
    socket.onclose = event => args.events.onmessage({ sequence: 0, events: [{ type: 'closed', code: event.code }] });
    return;
  }
  if (command === 'gui_remote_send') return sockets.get(args.request.clientId)!.send(JSON.stringify(args.request.message));
  if (command === 'gui_remote_close') { sockets.get(args.request.clientId)?.close(); sockets.delete(args.request.clientId); return; }
  if (command === 'gui_remote_ack') return;
  throw new Error(`Unexpected native command: ${command}`);
}

Object.assign(window, { __TAURI_INTERNALS__: { invoke, transformCallback: () => ++callbackId, unregisterCallback: () => {} },
  remoteGuiFixture: { commands, beats: () => beats, pauseDirectory: () => { holdDirectory = true; },
    copyImage: () => { clipboardImages = [{ mimeType: 'image/png', data: previewImage.split(',')[1] }]; },
    pauseClipboard: () => { holdClipboard = true; },
    releaseClipboard: () => { holdClipboard = false; pendingClipboard.splice(0).forEach(resolve => resolve()); },
    releaseDirectory: () => { holdDirectory = false; pendingDirectories.splice(0).forEach(resolve => resolve()); } } });
await import('./remote-gui-harness');

declare global {
  interface Window { remoteGuiFixture: {
    commands: string[]; beats: () => number; pauseDirectory: () => void; releaseDirectory: () => void;
    copyImage: () => void; pauseClipboard: () => void; releaseClipboard: () => void;
  } }
}
