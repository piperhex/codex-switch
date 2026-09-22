// Isolated local fixture service. All credentials and identities are synthetic.
import { createServer } from 'node:http';
import { createServer as createTLSServer } from 'node:https';
import { connect } from 'node:net';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

const sessions = new Map();
const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
const jwt = (identity) => `${encode({ alg: 'none', typ: 'JWT' })}.${encode({
  sub: `mock-${identity}-user`, email: `mock-${identity}@example.test`,
  'https://api.openai.com/auth': {
    chatgpt_user_id: `mock-${identity}-user`, chatgpt_account_id: `mock-${identity}-workspace`,
    chatgpt_plan_type: 'plus',
  },
})}.fixture-signature`;

function tokens(identity) {
  return { access_token: jwt(identity), id_token: jwt(identity), refresh_token: `mock-refresh-${identity}` };
}

export function handleFixture(method, pathname, body, headers = {}) {
  if (pathname === '/health') return [200, { ok: true }];
  if (pathname === '/v3/latest') {
    if (headers.apikey === 'fixture-fail') return [503, { message: 'Synthetic exchange rate outage' }];
    if (headers.apikey !== 'fixture-key') return [401, { message: 'Invalid synthetic API key' }];
    return [200, { data: { EUR: { value: 0.9 }, CNY: { value: 7.2 } } }];
  }
  if (pathname === '/api/accounts/deviceauth/usercode' && method === 'POST') {
    const id = randomUUID();
    sessions.set(id, 0);
    return [200, { device_auth_id: id, user_code: 'FIXTURE-CODE', interval: 1 }];
  }
  if (pathname === '/api/accounts/deviceauth/token' && method === 'POST') {
    if (!sessions.has(body.device_auth_id)) return [404, { error: 'authorization_pending' }];
    const polls = sessions.get(body.device_auth_id);
    sessions.set(body.device_auth_id, polls + 1);
    if (polls === 0) return [403, { error: 'authorization_pending' }];
    return [200, { authorization_code: 'device-fixture-code', code_verifier: 'fixture-verifier' }];
  }
  if (pathname === '/oauth/token' && method === 'POST') {
    if (body.code === 'fixture-denied') return [400, { error: 'invalid_grant' }];
    if (body.code === 'fixture-malformed') return [200, { access_token: 'missing-other-tokens' }];
    if (body.grant_type === 'refresh_token') return [200, tokens('refreshed')];
    if (body.grant_type !== 'authorization_code') return [400, { error: 'unsupported_grant_type' }];
    return [200, tokens(body.code === 'device-fixture-code' ? 'device' : 'embedded')];
  }
  const bearer = headers.authorization ?? '';
  if (pathname.startsWith('/backend-api/wham/') && bearer.includes('expired-fixture')) {
    return [401, { error: 'expired_token' }];
  }
  if (pathname === '/backend-api/wham/usage') {
    return [200, { plan_type: 'plus', rate_limit: {
      primary_window: { used_percent: 42, reset_at: 1893456000, limit_window_seconds: 18000 },
      secondary_window: { used_percent: 12, reset_at: 1893542400, limit_window_seconds: 604800 },
    }, promo: { expires_at: '2030-01-01T00:00:00.000Z' } }];
  }
  if (pathname === '/backend-api/wham/rate-limit-reset-credits') {
    if (bearer.includes('no-credit-fixture')) return [200, { credits: [] }];
    return [200, { credits: [
      { granted_at: 1767225600, expires_at: 1924992000 },
      { created_at: '2026-01-01T00:00:00Z', expires_at: 1893456000000 },
    ] }];
  }
  if (pathname === '/backend-api/wham/rate-limit-reset-credits/consume') return [200, { code: 'reset' }];
  return [404, { error: 'fixture_route_not_found' }];
}

async function respondFixture(request, response) {
  let raw = '';
  for await (const chunk of request) raw += chunk;
  let body = {};
  if (raw) {
    try {
      body = request.headers['content-type']?.includes('application/x-www-form-urlencoded')
        ? Object.fromEntries(new URLSearchParams(raw)) : JSON.parse(raw);
    } catch {
      response.writeHead(400, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ error: 'invalid_request' }));
      return;
    }
  }
  const [status, result] = handleFixture(
    request.method, new URL(request.url, 'http://fixture').pathname, body, request.headers,
  );
  response.writeHead(status, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify(result));
}
const server = createServer(respondFixture);
server.listen(Number(process.env.PORT ?? 8080), '0.0.0.0');

if (process.env.ENABLE_TLS_PROXY === '1') {
  const tlsServer = createTLSServer({
    key: readFileSync(new URL('./tls/server.key', import.meta.url)),
    cert: readFileSync(new URL('./tls/server.crt', import.meta.url)),
  }, respondFixture);
  tlsServer.listen(443, '0.0.0.0');
  const proxy = createServer((request, response) => {
    if (!request.url.startsWith('http://oauth:8080/')) { response.writeHead(403); response.end(); return; }
    void respondFixture(request, response);
  });
  proxy.on('connect', (request, downstream, head) => {
    if (!['chatgpt.com:443', 'auth.openai.com:443', 'api.currencyapi.com:443', 'oauth:8080'].includes(request.url)) {
      downstream.end('HTTP/1.1 403 Forbidden\r\n\r\n');
      return;
    }
    const upstream = connect(request.url === 'oauth:8080' ? 8080 : 443, '127.0.0.1', () => {
      downstream.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head.length) upstream.write(head);
      downstream.pipe(upstream);
      upstream.pipe(downstream);
    });
    upstream.on('error', () => downstream.destroy());
    downstream.on('error', () => upstream.destroy());
    downstream.on('close', () => upstream.destroy());
  });
  proxy.listen(8081, '0.0.0.0');
}
