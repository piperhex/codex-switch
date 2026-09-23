import type { ConnectionMode, PeerConnectionState } from './protocol';

type DiagnosticEvent = 'mode' | 'relay-timeout' | 'peer-created' | 'peer-create-failed' | 'peer-state'
  | 'peer-retry' | 'peer-offer-failed' | 'peer-signal-failed' | 'channel-closed' | 'link-failed';
interface DiagnosticFields {
  generation?: number;
  state?: PeerConnectionState;
  mode?: ConnectionMode;
  elapsedMs?: number;
  directHealthy?: boolean;
  relayHealthy?: boolean;
}
export type ConnectionDiagnostic = (event: DiagnosticEvent, fields?: DiagnosticFields) => void;

/** Only connection metadata belongs here: never log SDP, candidates, keys or message content. */
export function connectionDiagnostic(sessionId: string, desktop: boolean): ConnectionDiagnostic {
  return (event, fields) => console.debug('[remote-chat]', {
    event, sessionId, role: desktop ? 'desktop' : 'mobile', ...fields,
  });
}
