import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { createPair, fixturePassword, fixtureUsers, paths } from './parity-client.mjs';
import { resetAccountFixtures } from './reset-account-fixtures.mjs';

import {
  old, newer, newest, sides, assertExpectedStatuses, assertRouteCoverage, account, poolAuth, assertBoth, sessionPaths, stableOAuthStart
} from './parity-account-helpers.mjs';

async function syncAccounts(pair) {
  await pair.step('accounts requires authentication', 'GET', '/sync/accounts', { auth: false });
  await pair.step('account route id mismatch', 'PUT', '/sync/accounts/mismatch', { body: account('one') });
  await pair.step('account validation rejects nonboolean active', 'PUT', '/sync/accounts/invalid', {
    body: account('invalid', { active: 'true' }),
  });
  await pair.step('bulk sync accounts and default private fields', 'PUT', '/sync/accounts', { body: {
    accounts: [account('parity-a', { active: true }), account('parity-b')],
  } });
  const list = await pair.step('sync account full credentials', 'GET', '/sync/accounts');
  assertBoth(list, (body) => {
    assert.equal(body.accounts.find((row) => row.id === 'parity-a').active, true);
    assert.equal(body.accounts.find((row) => row.id === 'parity-a').fieldModifiedAt.note, old);
  });
  const device = await pair.step('unknown device does not inherit global active account', 'GET', '/sync/accounts', {
    headers: { 'x-device-id': '77777777-7777-4777-8777-777777777777' },
  });
  assertBoth(device, (body) => assert.ok(body.accounts.every((row) => !row.active)));
  await pair.step('empty replacement preserves existing accounts', 'PUT', '/sync/accounts', { body: { accounts: [] } });
  await pair.step('update account private details', 'PATCH', '/sync/accounts/parity-a/details', { body: {
    note: '中文备注', expiresAt: '2028-10-01', privateDetails: {
      password: 'private-password', phoneNumber: '+8612300000000', totpSecret: 'JBSWY3DPEHPK3PXP',
    },
  } });
  const summary = await pair.step('mobile summary only exposes short lived token', 'GET', '/sync/accounts/summary');
  assertBoth(summary, (body) => {
    const row = body.accounts.find((item) => item.id === 'parity-a');
    assert.equal(row.privateDetails.password, 'private-password');
    assert.equal(row.auth, undefined);
    assert.equal(row.codexAccessToken, 'opaque-parity-a');
  });
  const details = await pair.step('private details excludes access token', 'GET', '/sync/accounts/parity-a/details');
  assertBoth(details, (body) => { assert.equal(body.codexAccessToken, undefined); assert.equal(body.source, 'personal'); });
  const web = await pair.step('web summary omits all credentials', 'GET', '/sync/accounts/web-summary');
  assertBoth(web, (body) => {
    for (const row of body.accounts) {
      assert.equal(row.auth, undefined); assert.equal(row.privateDetails, undefined);
      assert.equal(row.codexAccessToken, undefined);
    }
  });
  await pair.step('new usage preserves newer metadata from another device', 'PUT', '/sync/accounts/parity-a', {
    body: account('parity-a', { note: 'stale note', usage: { plan: 'pro', primary: { remainingPercent: 75 } },
      fieldModifiedAt: { usage: newer } }),
  });
  const merged = await pair.step('merged account reads all field versions', 'GET', '/sync/accounts/parity-a/details');
  assertBoth(merged, (body) => {
    assert.equal(body.note, '中文备注'); assert.equal(body.plan, 'pro');
    assert.equal(body.fieldModifiedAt.usage, newer); assert.equal(body.privateDetails.password, 'private-password');
  });
  await pair.step('legacy client cannot overwrite versioned metadata', 'PUT', '/sync/accounts/parity-a', {
    body: account('parity-a', { note: 'legacy stale', lastModifiedAt: newest }),
  });
  await pair.step('profile account list redacts auth and private details', 'GET', '/admin/api/profile/accounts');
  await pair.step('admin user account list', 'GET', `/admin/api/users/${fixtureUsers.admin.id}/accounts`);
  await pair.step('delete account creates tombstone', 'DELETE', '/sync/accounts/parity-b');
  await pair.step('deleted account upload does not resurrect', 'PUT', '/sync/accounts/parity-b', {
    body: account('parity-b', { lastModifiedAt: newest }),
  });
  const deleted = await pair.step('account tombstone projection', 'GET', '/sync/accounts');
  assertBoth(deleted, (body) => assert.ok(body.deletedAccountIds.includes('parity-b')));
  await pair.step('deleted accounts list redacts credentials', 'GET', '/admin/api/profile/accounts/deleted');
  await pair.step('restore deleted account', 'POST', '/admin/api/profile/accounts/deleted/parity-b/restore');
  await pair.step('restore missing account', 'POST', '/admin/api/profile/accounts/deleted/absent/restore');
  await pair.step('patch own account administrative fields', 'PATCH', '/admin/api/profile/accounts/parity-b', {
    body: { note: 'Portal note', expiresAt: '2029-12-31' },
  });
  await pair.step('patch user synced account', 'PATCH', `/admin/api/users/${fixtureUsers.admin.id}/accounts/parity-b`, {
    body: { email: 'updated-parity-b@example.test', plan: 'team', active: true },
  });
}

async function syncProviders(pair) {
  const provider = {
    id: 'parity-provider', name: 'Fixture provider', baseUrl: 'https://provider.example.test/v1', apiKey: 'provider-key',
    model: 'fixture-model', models: ['fixture-model'], apiFormat: 'openaiResponses', group: '  测试组  ',
    modelReasoningEfforts: { 'fixture-model': ['high', 'high', 'invalid', 'max'], unknown: ['low'] },
    modelContextWindows: { 'fixture-model': 65536, unknown: 1000 },
    modelApiFormats: { 'fixture-model': 'openaiChat', unknown: 'openaiResponses' },
    walletUsername: 'wallet-user', walletPassword: 'wallet-secret', balanceQueryToken: 'balance-secret',
    lastModifiedAt: old,
  };
  await pair.step('upsert provider normalizes supported models', 'PUT', '/sync/providers/parity-provider', { body: provider });
  const providers = await pair.step('provider list with model settings and private credentials', 'GET', '/sync/providers');
  assertBoth(providers, (body) => {
    const row = body.providers.find((item) => item.id === provider.id);
    assert.deepEqual(row.modelReasoningEfforts, { 'fixture-model': ['high', 'max'] });
    assert.equal(row.group, '测试组');
  });
  await pair.step('provider field merge', 'PUT', '/sync/providers/parity-provider', {
    body: { ...provider, name: 'ignored name', apiKey: 'new-key', fieldModifiedAt: { apiKey: newer } },
  });
  await pair.step('provider legacy field protection', 'PUT', '/sync/providers', {
    body: { providers: [{ ...provider, name: 'legacy name', lastModifiedAt: newest }] },
  });
  const admin = await pair.step('admin provider view redacts all credentials', 'GET',
    `/admin/api/users/${fixtureUsers.admin.id}/providers`);
  assertBoth(admin, (body) => {
    const row = body.providers.find((item) => item.id === provider.id);
    assert.equal(row.name, provider.name); assert.equal(row.apiKey, undefined);
    assert.equal(row.walletPassword, undefined); assert.equal(row.hasWalletLoginCredentials, true);
  });
  await pair.step('provider id mismatch', 'PUT', '/sync/providers/mismatch', { body: provider });
  await pair.step('delete provider', 'DELETE', '/sync/providers/parity-provider');
  await pair.step('provider tombstones', 'GET', '/sync/providers');
  await pair.step('provider upload does not restore tombstone', 'PUT', '/sync/providers/parity-provider', {
    body: { ...provider, lastModifiedAt: newest },
  });
  await pair.step('deleted provider list', 'GET', '/admin/api/profile/providers/deleted');
  await pair.step('restore provider', 'POST', '/admin/api/profile/providers/deleted/parity-provider/restore');
  await pair.step('restored provider settings', 'GET', '/sync/providers');
}

async function syncTotp(pair) {
  const entry = { id: '22222222-2222-4222-8222-222222222222', issuer: 'Fixture', accountName: 'user@example.test',
    secret: 'JBSWY3DPEHPK3PXP', algorithm: 'SHA1', digits: 6, period: 30, createdAt: old, updatedAt: old };
  await pair.step('empty TOTP vault', 'GET', '/sync/totp');
  await pair.step('TOTP vault upload', 'PUT', '/sync/totp', { body: { entries: [entry], modifiedAt: old } });
  await pair.step('TOTP concurrent entry update', 'PUT', '/sync/totp', {
    body: { entries: [{ ...entry, issuer: 'New issuer', updatedAt: newer }], tombstones: [], modifiedAt: newer },
  });
  const stale = await pair.step('stale TOTP deletion preserves newer entry', 'PUT', '/sync/totp', {
    body: { entries: [], modifiedAt: old },
  });
  assertBoth(stale, (body) => { assert.equal(body.entries.length, 1); assert.equal(body.entries[0].updatedAt, newer); });
  const tie = await pair.step('TOTP tombstone wins timestamp tie', 'PUT', '/sync/totp', {
    body: { entries: [], tombstones: [{ id: entry.id, deletedAt: newer }], modifiedAt: newer },
  });
  assertBoth(tie, (body) => assert.equal(body.entries.length, 0));
  await pair.step('TOTP newer entry restores deleted entry', 'PUT', '/sync/totp', {
    body: { entries: [{ ...entry, updatedAt: newest }], tombstones: [], modifiedAt: newest },
  });
  await pair.step('TOTP malformed secret validation', 'PUT', '/sync/totp', {
    body: { entries: [{ ...entry, secret: 'invalid!' }], modifiedAt: old },
  });
  await pair.step('TOTP resulting vault', 'GET', '/sync/totp');
}

export async function runAccountNulls(pair) {
  pair = assertExpectedStatuses(pair);
  const id = 'parity-null';
  await pair.step('create null compatibility account', 'PUT', `/sync/accounts/${id}`, { body: account(id) });
  for (const field of ['note', 'expiresAt', 'email', 'plan', 'active', 'usage', 'auth']) {
    const nullable = ['note', 'expiresAt', 'usage'].includes(field);
    await pair.step(`admin null ${field} ${nullable ? 'uses legacy default' : 'preserves legacy storage error'}`,
      'PATCH', `/admin/api/users/${fixtureUsers.admin.id}/accounts/${id}`, { body: { [field]: null } });
  }
  for (const field of ['privateDetails', 'autoSwitchPriority', 'autoSwitchThreshold']) {
    await pair.step(`sync null ${field} preserves legacy storage error`, 'PUT', `/sync/accounts/${id}`, {
      body: account(id, { [field]: null, fieldModifiedAt: { [field]: newest } }),
    });
  }
  const pool = await pair.step('create pool null compatibility account', 'POST', '/admin/api/official-accounts', {
    body: { auth: poolAuth('pool-null'), note: null, usage: null },
  });
  for (const field of ['note', 'expiresAt', 'usage', 'auth']) {
    await pair.step(`pool null ${field} preserves legacy storage error`, 'PATCH',
      paths('/admin/api/official-accounts/', pool), { body: { [field]: null } });
  }
  await pair.step('delete pool null compatibility account', 'DELETE', paths('/admin/api/official-accounts/', pool));
}

async function officialPool(pair) {
  const created = await pair.step('create official pool account', 'POST', '/admin/api/official-accounts', {
    body: { auth: poolAuth('pool-parity-a'), note: '  Pool fixture  ', expiresAt: '2028-12-31' },
  });
  assert.equal(created.legacy.status, 201);
  await pair.step('duplicate pool credential rejected', 'POST', '/admin/api/official-accounts', {
    body: { auth: poolAuth('pool-parity-a') },
  });
  await pair.step('pool list with filter and count sorting', 'GET',
    '/admin/api/official-accounts?email=pool-parity&note=fixture&boundUserCount=0&sortBy=boundUserCount&sortOrder=asc');
  await pair.step('official pool patch preserves identity', 'PATCH', paths('/admin/api/official-accounts/', created), {
    body: { note: 'Updated pool note', usage: { remainingPercent: 55 } },
  });
  const bindingBody = (side) => ({ systemAccountIds: [created[side].body.id], userIds: [fixtureUsers.user.id] });
  await pair.step('bind official account to user', 'POST', '/admin/api/official-accounts/bind', { sideBody: bindingBody });
  const duplicateBind = await pair.step('official binding is idempotent', 'POST', '/admin/api/official-accounts/bind', {
    sideBody: bindingBody,
  });
  assertBoth(duplicateBind, (body) => assert.equal(body.count, 0));
  await pair.step('pool account binding list', 'GET', paths('/admin/api/official-accounts/', created, '/bindings'));
  await pair.step('official exact assigned-user filter', 'GET', '/admin/api/official-accounts?boundUserCount=1');
  const userAuth = await pair.login('user');
  const replacedAuth = poolAuth('pool-parity-a');
  delete replacedAuth.tokens.refresh_token;
  await pair.step('replace official credential object', 'PATCH', paths('/admin/api/official-accounts/', created), {
    body: { auth: replacedAuth },
  });
  const credentials = await pair.step('replaced official credentials omit removed refresh token', 'GET', '/sync/accounts', {
    auth: userAuth,
  });
  assertBoth(credentials, (body) => {
    assert.equal(body.accounts.find((row) => row.official).auth.tokens.refresh_token, undefined);
  });
  const summary = await pair.step('bound user receives official account', 'GET', '/sync/accounts/summary', { auth: userAuth });
  assertBoth(summary, (body) => assert.ok(body.accounts.some((row) => row.official)));
  const syncID = created.legacy.body.syncAccountId;
  await pair.step('user cannot change official metadata', 'PATCH', `/sync/accounts/${syncID}/details`, {
    auth: userAuth, body: { note: 'unauthorized', expiresAt: '2028-12-31' },
  });
  await pair.step('user private details remain account scoped', 'PATCH', `/sync/accounts/${syncID}/details`, {
    auth: userAuth, body: { note: 'Updated pool note', expiresAt: '2028-12-31',
      privateDetails: { password: 'personal-only', phoneNumber: '', totpSecret: '' } },
  });
  await pair.step('official private detail projection', 'GET', `/sync/accounts/${syncID}/details`, { auth: userAuth });
  await pair.step('delete assigned official account unbinds and records tombstone', 'DELETE', `/sync/accounts/${syncID}`, {
    auth: userAuth,
  });
  await pair.step('official deleted account projection', 'GET', '/sync/accounts', { auth: userAuth });
  await pair.step('official pool account still exists after user deletes it', 'GET', '/admin/api/official-accounts');
  await pair.step('rebind official account overrides user tombstone', 'POST', '/admin/api/official-accounts/bind', {
    sideBody: bindingBody,
  });
  await pair.step('rebound official effective state', 'GET', '/sync/accounts', { auth: userAuth });
  await pair.step('unbind official account', 'POST', '/admin/api/official-accounts/unbind', { sideBody: bindingBody });
  await otherPoolSources(pair, userAuth);
  const fromPersonal = await pair.step('add own account to official pool', 'POST',
    '/admin/api/profile/accounts/parity-b/add-to-pool');
  await pair.step('create official Agent Identity account', 'POST', '/admin/api/official-accounts', { body: { auth: {
    auth_mode: 'agentIdentity', agent_identity: { agent_runtime_id: 'fixture-runtime',
      agent_private_key: Buffer.alloc(32, 7).toString('base64'), account_id: 'agent-workspace',
      chatgpt_user_id: 'agent-user', email: 'agent@example.test', plan_type: 'team' },
  } } });
  await poolOwnerScope(pair, created);
  await pair.step('bulk delete validates every pool account', 'POST', '/admin/api/official-accounts/batch-delete', {
    sideBody: (side) => ({ systemAccountIds: [created[side].body.id, '88888888-8888-4888-8888-888888888888'] }),
  });
  await pair.step('bulk delete official accounts', 'POST', '/admin/api/official-accounts/batch-delete', {
    sideBody: (side) => ({ systemAccountIds: [created[side].body.id, fromPersonal[side].body.id] }),
  });
}

async function otherPoolSources(pair, userAuth) {
  const userAccountID = 'parity-user-pool';
  await pair.step('user synchronizes account for administrator pool import', 'PUT', `/sync/accounts/${userAccountID}`, {
    auth: userAuth, body: account(userAccountID),
  });
  const userPool = await pair.step('administrator adds user account to pool', 'POST',
    `/admin/api/users/${fixtureUsers.user.id}/accounts/${userAccountID}/add-to-pool`);
  assertBoth(userPool, (body) => { assert.equal(body.source, 'admin'); assert.equal(body.sourceAccountId, userAccountID); });
  await pair.step('administrator deletes user synced account', 'DELETE',
    `/admin/api/users/${fixtureUsers.user.id}/accounts/${userAccountID}`);
  await pair.step('administrator removes copied user pool account', 'DELETE', paths('/admin/api/official-accounts/', userPool));
  const accountIDs = ['parity-batch-a', 'parity-batch-b'];
  await pair.step('sync accounts for batch pool import', 'PUT', '/sync/accounts', {
    body: { accounts: accountIDs.map((id) => account(id)) },
  });
  const batch = await pair.step('add own accounts to pool as batch', 'POST', '/admin/api/profile/accounts/add-to-pool', {
    body: { accountIds: accountIDs },
  });
  assertBoth(batch, (body) => { assert.equal(body.count, 2); assert.ok(body.accounts.every((row) => row.source === 'desktop')); });
  await pair.step('remove batch-imported pool accounts', 'POST', '/admin/api/official-accounts/batch-delete', {
    sideBody: (side) => ({ systemAccountIds: batch[side].body.accounts.map((row) => row.id) }),
  });
}

async function poolOwnerScope(pair, other) {
  const suffix = Date.now().toString(36);
  const role = `pool_owner_${suffix}`;
  const email = `pool-owner-${suffix}@example.test`;
  const roleResult = await pair.step('create isolated own-pool management role', 'POST', '/admin/api/roles', {
    body: { code: role, name: 'Fixture pool owner', permissions: [
      'admin.official-accounts.read-own', 'admin.official-accounts.manage-own',
    ] },
  });
  assert.equal(roleResult.legacy.status, 201);
  const user = await pair.step('create isolated pool owner', 'POST', '/admin/api/users', {
    body: { email, password: fixturePassword, role },
  });
  assert.equal(user.legacy.status, 201);
  try {
    const login = await pair.step('login isolated pool owner', 'POST', '/auth/login', {
      auth: false, body: { email, password: fixturePassword },
    });
    const auth = sides.map((side) => login[side].body.accessToken);
    const own = await pair.step('own-pool manager creates official account', 'POST', '/admin/api/official-accounts', {
      auth, body: { auth: poolAuth('pool-own-scope') },
    });
    assert.equal(own.legacy.status, 201);
    const visible = await pair.step('own-pool manager only sees own contributions', 'GET', '/admin/api/official-accounts', {
      auth,
    });
    assertBoth(visible, (body) => { assert.equal(body.items.length, 1); assert.equal(body.items[0].email, 'pool-own-scope@example.test'); });
    await pair.step('own-pool manager cannot update another contribution', 'PATCH',
      paths('/admin/api/official-accounts/', other), { auth, body: { usage: { remainingPercent: 50 } } });
    await pair.step('own-pool manager cannot delete another contribution', 'DELETE',
      paths('/admin/api/official-accounts/', other), { auth });
    await pair.step('own-pool manager cannot inspect another contribution bindings', 'GET',
      paths('/admin/api/official-accounts/', other, '/bindings'), { auth });
    await pair.step('own-pool manager cannot bind another contribution', 'POST', '/admin/api/official-accounts/bind', {
      auth, sideBody: (side) => ({ systemAccountIds: [other[side].body.id], userIds: [fixtureUsers.user.id] }),
    });
    await pair.step('own-pool manager cannot edit metadata without metadata permission', 'PATCH',
      paths('/admin/api/official-accounts/', own), { auth, body: { note: 'No permission' } });
    const updated = await pair.step('own-pool manager updates own usage', 'PATCH',
      paths('/admin/api/official-accounts/', own), { auth, body: { usage: { remainingPercent: 65 } } });
    assert.equal(updated.legacy.status, 200);
    await pair.step('own-pool manager deletes own contribution', 'DELETE', paths('/admin/api/official-accounts/', own), {
      auth,
    });
  } finally {
    await pair.step('delete isolated pool owner', 'DELETE', paths('/admin/api/users/', user));
    await pair.step('delete isolated own-pool role', 'DELETE', `/admin/api/roles/${role}`);
  }
}

async function imports(pair) {
  await pair.step('compatible import finds nested accounts and skips bad duplicates', 'POST', '/admin/api/official-accounts/import', {
    body: { content: JSON.stringify({ data: { accounts: [
      { accessToken: 'import-access', user: { id: 'import-user', email: 'import@example.test' },
        account: { id: 'import-account', planType: 'team' }, note: 'Imported', expires: 1893456000 },
      { access_token: 'bad-token' },
    ] } }) },
  });
  await pair.step('sub2api import preserves opaque identity', 'POST', '/admin/api/official-accounts/import/sub2api', {
    body: { content: JSON.stringify({ type: 'sub2api-data', version: 1, accounts: [{
      platform: 'openai', type: 'oauth', credentials: { access_token: 'sub2api-access',
        chatgpt_user_id: 'sub2api-user', chatgpt_account_id: 'sub2api-account', email: 'sub2api@example.test' },
    }] }) },
  });
  await pair.step('personal import supports aliases and metadata', 'POST', '/sync/accounts/import', { body: {
    content: JSON.stringify([{ accessToken: 'personal-import-access', email: 'personal-import@example.test',
      user_id: 'personal-import-user', remark: 'Imported note', expiresAt: '2030-12-31' }]),
  } });
  await pair.step('personal import reports unusable credentials', 'POST', '/sync/accounts/import', {
    body: { content: JSON.stringify({ unrelated: true }) },
  });
  await pair.step('imported account summaries', 'GET', '/sync/accounts/summary');
  if (process.env.PARITY_TLS_MOCK === '1') {
    const refreshed = await pair.step('personal refresh-only import uses local verified TLS OAuth fixture', 'POST', '/sync/accounts/import', {
      body: { content: JSON.stringify({ refresh_token: 'fixture-refresh-only' }) },
    });
    assert.equal(refreshed.legacy.status, 201);
  }
  if (process.env.PARITY_OAUTH_MOCK === '1') {
    const refreshed = await pair.step('official refresh-only import exchanges synthetic credentials', 'POST',
      '/admin/api/official-accounts/import', {
        body: { content: JSON.stringify({ refresh_token: 'official-fixture-refresh-only' }) },
      });
    assert.equal(refreshed.legacy.status, 201);
  }
}

async function upstreamUsage(pair) {
  if (process.env.PARITY_TLS_MOCK !== '1') return;
  await pair.step('live usage request through verified TLS fixture', 'GET', '/sync/accounts/parity-a/usage');
  await pair.step('reset credits normalize seconds milliseconds and timestamps', 'GET',
    '/sync/accounts/parity-a/reset-credits');
  await pair.step('consume available reset credit', 'POST', '/sync/accounts/parity-a/reset-credits/consume');
  await pair.step('create account with expired synthetic access token', 'PUT', '/sync/accounts/parity-expired', {
    body: account('parity-expired', { auth: { tokens: {
      access_token: 'expired-fixture', refresh_token: 'fixture-refresh', email: 'expired@example.test',
    } } }),
  });
  await pair.step('401 refresh persists replacement credentials and retries', 'GET',
    '/sync/accounts/parity-expired/reset-credits');
  await pair.step('refreshed credential available to authenticated client', 'GET', '/sync/accounts/summary');
  await pair.step('create account with no reset credits', 'PUT', '/sync/accounts/parity-no-credit', {
    body: account('parity-no-credit', { auth: { tokens: { access_token: 'no-credit-fixture' } } }),
  });
  const empty = await pair.step('consume rejects accounts without reset credits', 'POST',
    '/sync/accounts/parity-no-credit/reset-credits/consume');
  assert.equal(empty.legacy.status, 400);
}

export async function runAccountOAuth(pair) {
  pair = assertExpectedStatuses(pair);
  await pair.step('invalid OAuth session identifier', 'POST', '/sync/accounts/oauth/invalid/poll');
  const start = await pair.step('embedded OAuth start', 'POST', '/sync/accounts/oauth/embedded/start', {
    normalize: stableOAuthStart,
  });
  assertBoth(start, (body) => {
    assert.ok(body.sessionId.length >= 40);
    const url = new URL(body.authorizationUrl);
    assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
    assert.ok(url.searchParams.get('state').length >= 40);
  });
  await pair.step('embedded OAuth pending session', 'POST', sessionPaths(start, 'poll', true));
  await pair.step('embedded OAuth sessions cannot be polled by another user', 'POST', sessionPaths(start, 'poll', true), {
    auth: await pair.login('user'),
  });
  await pair.step('embedded OAuth rejects wrong state', 'POST', sessionPaths(start, 'complete', true), {
    body: { state: 'wrong', code: 'fixture-code' },
  });
  await pair.step('embedded OAuth authorization cancellation', 'POST', sessionPaths(start, 'complete', true), {
    sideBody: (side) => ({ state: new URL(start[side].body.authorizationUrl).searchParams.get('state'), error: 'access_denied' }),
  });
  await pair.step('embedded OAuth terminal cancellation polling', 'POST', sessionPaths(start, 'poll', true));
  if (process.env.PARITY_OAUTH_MOCK !== '1') return;
  const embedded = await pair.step('embedded OAuth success start', 'POST', '/sync/accounts/oauth/embedded/start', {
    normalize: stableOAuthStart,
  });
  const embeddedResult = await pair.step('embedded OAuth exchanges PKCE and persists personal account', 'POST',
    sessionPaths(embedded, 'complete', true), {
      sideBody: (side) => ({
        state: new URL(embedded[side].body.authorizationUrl).searchParams.get('state'), code: 'embedded-fixture-code',
      }),
    });
  assertBoth(embeddedResult, (body) => assert.equal(body.status, 'complete'));
  await pair.step('embedded OAuth successful terminal poll', 'POST', sessionPaths(embedded, 'poll', true));
  const device = await pair.step('device OAuth start', 'POST', '/sync/accounts/oauth/start', { normalize: stableOAuthStart });
  for (let attempt = 0; attempt < 3; attempt++) {
    const result = await pair.step(`device OAuth poll ${attempt}`, 'POST', sessionPaths(device, 'poll'));
    if (result.legacy.body.status !== 'pending') {
      assertBoth(result, (body) => assert.equal(body.status, 'complete'));
      break;
    }
  }
  const official = await pair.step('official device OAuth start', 'POST', '/admin/api/official-accounts/oauth/start', {
    normalize: stableOAuthStart,
  });
  for (let attempt = 0; attempt < 3; attempt++) {
    const result = await pair.step(`official OAuth poll ${attempt}`, 'POST', sessionPaths(official, 'poll', false, true));
    if (result.legacy.body.status !== 'pending') {
      assertBoth(result, (body) => assert.equal(body.status, 'complete'));
      break;
    }
  }
}

export async function runAccounts(pair) {
  pair = assertExpectedStatuses(pair);
  await resetAccountFixtures();
  await syncAccounts(pair);
  await syncProviders(pair);
  await syncTotp(pair);
  await runAccountNulls(pair);
  await officialPool(pair);
  await imports(pair);
  await upstreamUsage(pair);
  await runAccountOAuth(pair);
  assertRouteCoverage(pair);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const pair = await createPair();
  await runAccounts(pair);
  console.log(`Accounts parity passed ${pair.results.length} checks.`);
}
