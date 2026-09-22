import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const old = '2025-01-01T00:00:00.000Z';
const newer = '2030-01-01T00:00:00.000Z';
const newest = '2031-01-01T00:00:00.000Z';
const sides = ['legacy', 'modern'];
const exceptionalStatuses = new Map([
  ['accounts requires authentication', 401], ['account route id mismatch', 400],
  ['account validation rejects nonboolean active', 400], ['restore missing account', 404],
  ['provider id mismatch', 400], ['TOTP malformed secret validation', 400],
  ['duplicate pool credential rejected', 409], ['user cannot change official metadata', 403],
  ['bulk delete validates every pool account', 404], ['personal import reports unusable credentials', 400],
  ['consume rejects accounts without reset credits', 400], ['invalid OAuth session identifier', 404],
  ['embedded OAuth rejects wrong state', 403], ['embedded OAuth sessions cannot be polled by another user', 403],
  ['own-pool manager cannot update another contribution', 404],
  ['own-pool manager cannot delete another contribution', 404],
  ['own-pool manager cannot inspect another contribution bindings', 404],
  ['own-pool manager cannot bind another contribution', 404],
  ['own-pool manager cannot edit metadata without metadata permission', 403],
  ...['email', 'plan', 'active', 'auth'].map((field) => [`admin null ${field} preserves legacy storage error`, 500]),
  ...['note', 'expiresAt', 'usage', 'auth'].map((field) => [`pool null ${field} preserves legacy storage error`, 500]),
  ...['privateDetails', 'autoSwitchPriority', 'autoSwitchThreshold'].map((field) => [
    `sync null ${field} preserves legacy storage error`, 500,
  ]),
]);
function assertExpectedStatuses(pair) {
  if (pair.accountStatusesChecked) return pair;
  pair.accountRouteCoverage ??= new Set();
  return { ...pair, accountStatusesChecked: true, async step(label, method, path, options) {
    const result = await pair.step(label, method, path, options);
    pair.accountRouteCoverage.add(`${method} ${(Array.isArray(path) ? path[0] : path).split('?')[0]}`);
    const expected = exceptionalStatuses.get(label) ?? (method === 'POST' ? 201 : 200);
    for (const side of sides) assert.equal(result[side].status, expected, `${label}: expected ${expected} on ${side}`);
    return result;
  } };
}

function assertRouteCoverage(pair) {
  const contract = JSON.parse(readFileSync(new URL('../internal/platform/legacy-contract.json', import.meta.url), 'utf8'));
  const routes = contract.routes.filter((route) => route.path.startsWith('/sync')
    || /^\/admin\/api\/(official-accounts|profile\/(accounts|providers)|users\/:[^/]+\/(accounts|providers))/.test(route.path));
  const missing = routes.filter((route) => {
    const pattern = new RegExp(`^${route.method} ${route.path.replace(/:[^/]+/g, '[^/]+')}$`);
    return ![...pair.accountRouteCoverage].some((request) => pattern.test(request));
  });
  console.log(`Account route coverage: ${routes.length - missing.length}/${routes.length}`);
  if (process.env.PARITY_OAUTH_MOCK === '1' && process.env.PARITY_TLS_MOCK === '1') {
    assert.deepEqual(missing.map((route) => `${route.method} ${route.path}`), [], 'account routes missing parity scenarios');
  }
}
const account = (id, extra = {}) => ({
  id, email: `${id}@example.test`, plan: 'plus', active: false, note: 'Initial note', expiresAt: '2027-01-01',
  auth: { tokens: { access_token: `opaque-${id}`, refresh_token: `refresh-${id}`, email: `${id}@example.test` } },
  usage: { plan: 'plus' }, lastModifiedAt: old, ...extra,
});
const poolAuth = (identity) => ({ tokens: {
  access_token: `opaque-${identity}`, refresh_token: `refresh-${identity}`, chatgpt_user_id: identity,
  account_id: `workspace-${identity}`, email: `${identity}@example.test`, plan_type: 'plus',
} });
function assertBoth(result, fn) { for (const side of sides) fn(result[side].body, side); }
function sessionPaths(start, suffix, embedded = false, official = false) {
  const prefix = official ? '/admin/api/official-accounts/oauth' : `/sync/accounts/oauth${embedded ? '/embedded' : ''}`;
  return sides.map((side) => `${prefix}/${start[side].body.sessionId}/${suffix}`);
}
function stableOAuthStart(value) {
  const copy = { ...value };
  delete copy.sessionId;
  if (copy.authorizationUrl) {
    const url = new URL(copy.authorizationUrl);
    url.searchParams.delete('state');
    url.searchParams.delete('code_challenge');
    copy.authorizationUrl = url.toString();
  }
  return copy;
}

export { old, newer, newest, sides, assertExpectedStatuses, assertRouteCoverage, account, poolAuth, assertBoth, sessionPaths, stableOAuthStart };
