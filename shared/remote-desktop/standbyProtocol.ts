import type { IceServer } from '../remote-chat/protocol';

export const STANDBY_PING = '{"kind":"standby-ping"}';
export const STANDBY_PONG = '{"kind":"standby-pong"}';
export const STANDBY_ACTIVATE = '{"kind":"standby-activate"}';
export const STANDBY_ACTIVE = '{"kind":"standby-active"}';

/** A native adapter is a direct route, so it cannot serve as an independent relay backup. */
export function relayIceServers(servers: IceServer[]): IceServer[] {
  return servers.filter(server => !server.nativeMedia).flatMap(server => {
    const urls = (Array.isArray(server.urls) ? server.urls : [server.urls])
      .filter(url => /^turns?:/i.test(url));
    return urls.length ? [{ ...server, urls }] : [];
  });
}
