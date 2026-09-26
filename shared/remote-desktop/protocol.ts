import type { IceServer } from '../remote-chat/protocol';

export const DESKTOP_OPERATION = 'remoteDesktop';
export const MAX_FPS = 144;
export const DEFAULT_SETTINGS: DesktopSettings = { fps: 'auto', quality: 'auto' };
export type DesktopQuality = 'auto' | 'smooth' | 'clear' | 'original';
export interface DesktopSettings { fps: 'auto' | number; quality: DesktopQuality }
export interface DesktopOffer { sdp: string; iceServers: IceServer[] }
export interface DesktopSignal { answer?: string; candidates: RTCIceCandidateInit[] }
export interface DesktopStats { fps: number; width: number; height: number; bitrate: number }
export type DesktopInput =
  | { kind: 'move'; x: number; y: number }
  | { kind: 'button'; button: 'left' | 'right'; down: boolean }
  | { kind: 'wheel'; delta: number }
  | { kind: 'text'; text: string }
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
  return { fps: input.fps!, quality: input.quality! };
}
