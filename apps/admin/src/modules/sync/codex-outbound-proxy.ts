import { ProxyAgent, type Dispatcher } from 'undici';

export const CODEX_OUTBOUND_PROXY_ENV = 'CODEX_OUTBOUND_PROXY';

export type ProxyAwareRequestInit = RequestInit & {
  dispatcher?: Dispatcher;
};

export function createCodexOutboundDispatcher(
  proxyUrl?: string,
): Dispatcher | undefined {
  const value = proxyUrl?.trim();
  if (!value) return undefined;

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${CODEX_OUTBOUND_PROXY_ENV} must be a valid HTTP(S) proxy URL`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`${CODEX_OUTBOUND_PROXY_ENV} must use the http or https protocol`);
  }

  return new ProxyAgent(value);
}

export function withCodexOutboundDispatcher(
  init: RequestInit,
  dispatcher: Dispatcher | undefined,
): ProxyAwareRequestInit {
  if (!dispatcher) return init;
  return { ...init, dispatcher };
}
