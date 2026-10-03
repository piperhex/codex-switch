import type { IceServer } from '../remote-chat/protocol';
import type { ConnectionDiagnostic } from '../remote-chat/diagnostics';

const OPEN_TIMEOUT = 4000;
const CLOSE_TIMEOUT = 2000;

export interface NativeMediaEndpoint extends IceServer { localAddress: string; remoteAddress: string }
// Native route status serializes absent Option fields as null during connection recovery.
export interface NativeMediaRoute { direct: boolean; protocol?: string | null; ipv6: boolean; rttMs?: number | null }
export interface NativeMediaSession {
  endpoint: NativeMediaEndpoint;
  status(): Promise<NativeMediaRoute>;
  close(): Promise<void>;
}
export type NativeMediaFactory = (viewId: string) => Promise<NativeMediaSession | undefined>;

/** A slow or older native module must not prevent the ordinary WebRTC fallback from opening. */
export async function openNativeMedia(factory: NativeMediaFactory | undefined, viewId: string,
  diagnostic?: ConnectionDiagnostic): Promise<NativeMediaSession | undefined> {
  if (!factory) return undefined;
  let expired = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const opening = factory(viewId).then(async session => {
      if (!expired) return session;
      await closeNativeMedia(session); return undefined;
    });
    return await Promise.race([opening, new Promise<undefined>(resolve => {
      timer = setTimeout(() => { expired = true; resolve(undefined); }, OPEN_TIMEOUT);
    })]);
  } catch {
    diagnostic?.('path-state', { scope: 'desktop', transport: 'mesh', state: 'failed' });
    return undefined;
  } finally { clearTimeout(timer); }
}

export async function closeNativeMedia(session?: NativeMediaSession) {
  if (!session) return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([session.close(), new Promise<void>(resolve => { timer = setTimeout(resolve, CLOSE_TIMEOUT); })]);
  } catch { /* Closing the parent chat grant also releases the native adapter. */ }
  finally { clearTimeout(timer); }
}

/** Identify only the local adapter's exact virtual pair, never an arbitrary TURN relay. */
export function isNativeMediaPair(
  pair: { local?: Record<string, unknown>; remote?: Record<string, unknown> }, endpoint?: NativeMediaEndpoint,
) {
  return Boolean(endpoint && pair.local?.candidateType === 'relay'
    && (pair.local.address ?? pair.local.ip) === endpoint.localAddress
    && (pair.remote?.address ?? pair.remote?.ip) === endpoint.remoteAddress);
}

/** Public TURN remains excluded from direct probes; authenticated native adapters stay eligible. */
export function nativeMediaIceServers(servers: IceServer[], endpoint?: NativeMediaEndpoint): IceServer[] {
  return endpoint ? [{ ...endpoint, nativeMedia: true }, ...servers] : servers;
}

export function nativeMediaEndpoint(servers: IceServer[]): NativeMediaEndpoint | undefined {
  const endpoint = servers.find(server => server.nativeMedia) as Partial<NativeMediaEndpoint> | undefined;
  return endpoint && typeof endpoint.localAddress === 'string' && typeof endpoint.remoteAddress === 'string'
    ? endpoint as NativeMediaEndpoint : undefined;
}
