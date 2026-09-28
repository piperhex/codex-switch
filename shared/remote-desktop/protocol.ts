import type { IceServer } from '../remote-chat/protocol';

export const DESKTOP_OPERATION = 'remoteDesktop';
export const MAX_FPS = 144;
export const DEFAULT_SETTINGS: DesktopSettings = { fps: 'auto', quality: 'auto' };
export type DesktopQuality = 'auto' | 'smooth' | 'clear' | 'original';
export interface DesktopSettings {
  fps: 'auto' | number; quality: DesktopQuality; displayId?: string; clipboardChannel?: boolean;
}
export interface DesktopDisplay { id: string; name: string; width: number; height: number; primary: boolean }
export interface DesktopPermissions {
  enabled: boolean; control: boolean; clipboardRead: boolean; clipboardWrite: boolean; files: boolean; audio: boolean;
}
export interface DesktopDisplays { displays?: DesktopDisplay[]; displayId?: string; permissions?: DesktopPermissions }
export interface DesktopCapabilities {
  keyboard?: boolean; clipboard?: boolean; horizontalScroll?: boolean; control?: boolean;
}
export interface DesktopOffer extends DesktopDisplays {
  sdp: string; iceServers: IceServer[]; capabilities?: DesktopCapabilities;
}
export interface DesktopSignal { answer?: string; candidates: RTCIceCandidateInit[] }
export interface DesktopStats {
  audio?: 'starting' | 'playing' | 'unavailable';
  fps: number; width: number; height: number; bitrate: number; connection?: 'direct' | 'relay';
  receivedFps?: number; receivedBitrate?: number; elapsedSeconds?: number;
  rttMs?: number; decodeMs?: number; lossPercent?: number;
  transport?: 'UDP' | 'TCP' | 'TLS'; network?: 'Wi-Fi' | 'Ethernet' | 'Cellular';
}
export type DesktopInput =
  | { kind: 'move'; x: number; y: number }
  | { kind: 'button'; button: 'left' | 'right' | 'middle'; down: boolean }
  | { kind: 'wheel'; delta: number; horizontal?: boolean }
  | { kind: 'text'; text: string }
  | { kind: 'keyboard'; code: string; down: boolean }
  | { kind: 'key'; key: 'enter' | 'backspace' | 'escape' | 'tab' | 'desktop' | 'windows' };
export interface DesktopClient {
  open(id: string, settings: DesktopSettings): Promise<DesktopOffer>;
  signal(id: string, signal: DesktopSignal): Promise<{ candidates: RTCIceCandidateInit[] }>;
  settings(id: string, settings: DesktopSettings): Promise<void>;
  close(id: string): Promise<void>;
}

export function desktopClient(request: <T>(body: object) => Promise<T>): DesktopClient {
  const call = <T>(action: string, body: object) => request<T>({ operation: DESKTOP_OPERATION, action, ...body });
  return {
    open: (id, settings) => call('open', { id, settings }),
    signal: (id, signal) => call('signal', { id, ...signal }),
    settings: (id, settings) => call('settings', { id, settings }),
    close: id => call('close', { id }),
  };
}

export function validateSettings(value: unknown): DesktopSettings {
  const input = value as Partial<DesktopSettings> | null;
  if (!input || !['auto', 'smooth', 'clear', 'original'].includes(String(input.quality))) {
    throw new Error('请选择有效的画质。');
  }
  if (input.fps !== 'auto' && (!Number.isInteger(input.fps) || Number(input.fps) < 1 || Number(input.fps) > MAX_FPS)) {
    throw new Error(`帧率应为 1–${MAX_FPS} 的整数。`);
  }
  if (input.displayId !== undefined && (typeof input.displayId !== 'string'
    || !input.displayId.length || input.displayId.length > 128)) {
    throw new Error('请选择有效的显示器。');
  }
  return { fps: input.fps!, quality: input.quality!,
    ...(input.clipboardChannel === true ? { clipboardChannel: true } : {}),
    ...(input.displayId === undefined ? {} : { displayId: input.displayId }) };
}
