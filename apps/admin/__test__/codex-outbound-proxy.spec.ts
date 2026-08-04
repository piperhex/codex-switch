import { ProxyAgent } from 'undici';
import {
  createCodexOutboundDispatcher,
  withCodexOutboundDispatcher,
} from '@/modules/sync/codex-outbound-proxy';

describe('Codex outbound proxy', () => {
  it('keeps Codex requests direct when the proxy is unset', () => {
    expect(createCodexOutboundDispatcher(undefined)).toBeUndefined();
    expect(createCodexOutboundDispatcher('  ')).toBeUndefined();

    const init: RequestInit = { method: 'GET' };
    expect(withCodexOutboundDispatcher(init, undefined)).toBe(init);
  });

  it('attaches an HTTP proxy dispatcher to Codex requests', async () => {
    const dispatcher = createCodexOutboundDispatcher('http://host.docker.internal:7890');
    expect(dispatcher).toBeInstanceOf(ProxyAgent);

    const init = withCodexOutboundDispatcher({ method: 'POST' }, dispatcher);
    expect(init.dispatcher).toBe(dispatcher);

    await dispatcher?.close();
  });

  it('rejects unsupported or malformed proxy URLs', () => {
    expect(() => createCodexOutboundDispatcher('socks5://127.0.0.1:7890')).toThrow(
      'must use the http or https protocol',
    );
    expect(() => createCodexOutboundDispatcher('not a URL')).toThrow(
      'must be a valid HTTP(S) proxy URL',
    );
  });
});
