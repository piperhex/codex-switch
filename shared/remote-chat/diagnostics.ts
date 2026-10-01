import { DIAGNOSTIC_EVENTS, sanitizeDiagnostic, type DiagnosticEvent, type DiagnosticFields } from './diagnosticSchema';
export type { DiagnosticEvent, DiagnosticFields } from './diagnosticSchema';
export type ConnectionDiagnostic = (event: DiagnosticEvent, fields?: DiagnosticFields) => void;
const WINDOW_MS = 60_000;
const MAX_EVENTS = 180;

/** Only connection metadata belongs here: never log SDP, candidates, keys or message content. */
export function connectionDiagnostic(sessionId: string, desktop: boolean,
  report?: ConnectionDiagnostic): ConnectionDiagnostic {
  const started = Date.now();
  let window = started, count = 0, suppressed = 0;
  const emit: ConnectionDiagnostic = (event, fields) => {
    const safe = sanitizeDiagnostic({ scope: 'chat', elapsedMs: Date.now() - started, ...fields });
    console.debug('[remote-chat]', { event, sessionId, role: desktop ? 'desktop' : 'mobile', ...safe });
    try { report?.(event, safe); } catch { /* Best-effort diagnostics must never break a connection. */ }
  };
  return (event, fields) => {
    if (!DIAGNOSTIC_EVENTS.includes(event)) return;
    if (Date.now() - window >= WINDOW_MS) {
      window = Date.now(); count = 0;
      if (suppressed) { emit('diagnostic-throttled', { suppressed }); suppressed = 0; }
    }
    if (count++ >= MAX_EVENTS) { suppressed++; return; }
    emit(event, fields);
  };
}
