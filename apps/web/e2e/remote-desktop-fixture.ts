import type { DesktopInput, DesktopSettings } from '../../../shared/remote-desktop/protocol';
import { RemoteDesktopHost } from '../../desktop/src/remoteDesktop/host';
import { createGuiToolsClient } from '../../../shared/remote-chat/guiTools';

const canvas = document.createElement('canvas');
let opened = 0;
export const desktopTest = { inputs: [] as DesktopInput[], settings: [] as DesktopSettings[],
  frames: 0, captures: 0, closed: 0, concurrent: 0, maxConcurrent: 0, errors: [] as string[] };

async function frame(width: number) {
  desktopTest.concurrent += 1;
  desktopTest.maxConcurrent = Math.max(desktopTest.maxConcurrent, desktopTest.concurrent);
  canvas.width = width; canvas.height = Math.round(width * 9 / 16);
  const context = canvas.getContext('2d')!;
  context.scale(width / 1600, width / 1600);
  context.fillStyle = '#12344e'; context.fillRect(0, 0, 1600, 900);
  context.fillStyle = '#eff4fb'; context.fillRect(130, 95, 1300, 695);
  context.fillStyle = '#dae4f2'; context.fillRect(130, 95, 1300, 65);
  context.font = '30px sans-serif'; context.fillStyle = '#263c58'; context.fillText('Codex Switch · Windows', 160, 138);
  context.font = '38px sans-serif'; context.fillText('远程桌面', 200, 245);
  context.font = '22px sans-serif'; context.fillText('原生视频连接测试', 200, 295);
  for (let row = 0; row < 4; row++) {
    context.fillStyle = row % 2 ? '#e5ecf7' : '#f7f9fd'; context.fillRect(200, 340 + row * 90, 1160, 70);
    context.fillStyle = '#314c70'; context.fillText(['项目', '文件', '终端', '设置'][row], 230, 385 + row * 90);
  }
  context.fillStyle = '#94bdea'; context.fillRect((desktopTest.frames * 4) % 1500, 845, 100, 12);
  context.fillStyle = '#24384d'; context.fillRect(0, 870, 1600, 30);
  desktopTest.frames += 1;
  try {
    const blob = await new Promise<Blob>(resolve => canvas.toBlob(value => resolve(value!), 'image/jpeg', 0.85));
    return await blob.arrayBuffer();
  } finally { desktopTest.concurrent -= 1; }
}

// Only native IPC is substituted. Host capture pacing, WebRTC/SRTP, receiver and controls are production code.
Object.defineProperty(window, '__TAURI_INTERNALS__', { value: {
  invoke: async (command: string, args: { width?: number; input?: DesktopInput }) => {
    if (command === 'remote_desktop_open') { desktopTest.captures += 1; return `capture-${++opened}`; }
    if (command === 'remote_desktop_frame') return frame(args.width!);
    if (command === 'remote_desktop_input') { desktopTest.inputs.push(args.input!); return; }
    if (command === 'remote_desktop_close') { desktopTest.closed += 1; return; }
    throw new Error(`Unexpected native call: ${command}`);
  },
}, configurable: true });

const host = new RemoteDesktopHost(); host.register('fixture', []);
export async function desktopRequest<T>(body: object): Promise<T> {
  const request = body as { action: string; settings?: DesktopSettings };
  if (request.settings) desktopTest.settings.push(request.settings);
  try { return await host.request(body, 'fixture') as T; }
  catch (error) { desktopTest.errors.push(String(error)); throw error; }
}
export const client = createGuiToolsClient(desktopRequest);
Object.assign(window, { desktopTest });
window.addEventListener('beforeunload', () => host.release());
