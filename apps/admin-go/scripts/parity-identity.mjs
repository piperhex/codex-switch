import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { createPair, fixturePassword, fixtureUsers, paths, request } from './parity-client.mjs';
import { fixtureDatabase } from './seed-parity.mjs';

const missingID = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
const unique = `${Date.now().toString(36)}`;
const require = createRequire(new URL('../testdata/tools/package.json', import.meta.url));
const Redis = require('ioredis');

export async function runIdentity(pair) {
  await cleanupInterruptedUsers(pair);
  await authentication(pair);
  await administrationGuards(pair);
  const originalTokens = { ...pair.tokens };
  const actor = await isolatedActor(pair);
  let createdUser;
  try {
    const roleCode = await rolesAndPermissions(pair);
    createdUser = await users(pair, roleCode);
    await invitationsAndApprovals(pair, createdUser, roleCode);
    await mailAndTemplates(pair);
    await verificationFlow(pair);
    await concurrentRefresh(pair);
    await refreshMigration(pair);
    await pair.step('audit logs for current identity fixture', 'GET', `/admin/api/audit-logs?pageSize=100&search=${unique}`);
    await pair.step('audit action and email search', 'GET', `/admin/api/audit-logs?action=user.create&search=${unique}`);
    await pair.step('delete created user', 'DELETE', paths('/admin/api/users/', createdUser));
    createdUser = undefined;
    await pair.step('delete unassigned custom role', 'DELETE', `/admin/api/roles/${roleCode}`);
  } finally {
    Object.assign(pair.tokens, originalTokens);
    if (createdUser) await pair.request('DELETE', paths('/admin/api/users/', createdUser));
    await pair.request('DELETE', paths('/admin/api/users/', actor));
  }
}

async function cleanupInterruptedUsers(pair) {
  // Only synthetic users belonging to this scenario can survive an interrupted assertion.
  for (const side of ['legacy', 'modern']) {
    const database = await fixtureDatabase(side === 'legacy' ? 'legacy' : 'admin_go');
    try {
      const { rows } = await database.query(`SELECT id FROM users WHERE email LIKE 'created-fixture-%@example.test'
        OR email LIKE 'identity-admin-%@example.test'`);
      for (const row of rows) await request(pair.urls[side], 'DELETE', `/admin/api/users/${row.id}`, { token: pair.tokens[side] });
    } finally { await database.end(); }
  }
}

async function isolatedActor(pair) {
  const email = `identity-admin-${unique}@example.test`;
  const actor = await pair.step('create isolated identity audit actor', 'POST', '/admin/api/users', {
    body: { email, password: fixturePassword, role: 'admin' },
  });
  const login = await pair.step('login isolated identity actor', 'POST', '/auth/login', { auth: false, body: { email, password: fixturePassword } });
  for (const side of ['legacy', 'modern']) pair.tokens[side] = login[side].body.accessToken;
  pair.selfIDs = [actor.legacy.body.id, actor.modern.body.id];
  return actor;
}

async function authentication(pair) {
  await pair.step('anonymous auth me', 'GET', '/auth/me', { auth: false });
  await pair.step('anonymous admin route', 'GET', '/admin/api/users', { auth: false });
  await pair.step('invalid bearer signature', 'GET', '/auth/me', { auth: ['invalid', 'invalid'] });
  await pair.step('auth me', 'GET', '/auth/me');
  await pair.step('legacy and Go JWT interoperability', 'GET', '/auth/me', {
    auth: [pair.tokens.modern, pair.tokens.legacy],
  });
  await pair.step('login wrong password', 'POST', '/auth/login', {
    auth: false, body: { email: fixtureUsers.admin.email, password: 'Wrong-password' },
  });
  await pair.step('disabled login', 'POST', '/auth/login', {
    auth: false, body: { email: fixtureUsers.disabled.email, password: fixturePassword },
  });
  await pair.step('DTO unknown field validation', 'POST', '/auth/login', {
    auth: false, body: { email: fixtureUsers.admin.email, password: fixturePassword, unexpected: true },
  });
  await pair.step('DTO missing login fields', 'POST', '/auth/login', { auth: false, body: {} });
  await pair.step('invalid refresh token', 'POST', '/auth/refresh', { auth: false, body: { refreshToken: 'not-a-jwt' } });
  await pair.step('unknown logout idempotent', 'POST', '/auth/logout', { auth: false, body: { refreshToken: 'unknown' } });
  const restricted = await pair.login('restricted');
  await pair.step('restricted permission guard', 'GET', '/admin/api/users', { auth: restricted });
  const user = await pair.login('user');
  await pair.step('user self password invalid', 'PATCH', '/admin/api/profile/password', {
    auth: user, body: { currentPassword: 'incorrect', newPassword: 'Replacement-2026!' },
  });
}

async function rolesAndPermissions(pair) {
  await pair.step('permission catalog', 'GET', '/admin/api/permissions');
  await pair.step('role catalog', 'GET', '/admin/api/roles');
  await pair.step('reserved permission namespace', 'POST', '/admin/api/permissions', {
    body: { code: 'admin.custom', name: 'Bad', group: 'custom' },
  });
  const permission = `fixture.feature-${unique}`;
  await pair.step('create permission', 'POST', '/admin/api/permissions', {
    body: { code: permission, name: ' Fixture feature ', group: ' fixture ', description: ' Test ' },
  });
  await pair.step('duplicate permission', 'POST', '/admin/api/permissions', {
    body: { code: permission, name: 'Duplicate', group: 'fixture' },
  });
  await pair.step('update permission', 'PATCH', `/admin/api/permissions/${permission}`, {
    body: { name: 'Updated feature', description: 'Updated description' },
  });
  await pair.step('built-in permission immutable', 'PATCH', '/admin/api/permissions/admin.users.read', { body: { name: 'Forbidden' } });
  const code = `fixture_${unique}`;
  await pair.step('create role with dependencies', 'POST', '/admin/api/roles', {
    body: { code, name: 'Fixture custom role', permissions: ['admin.email-templates.manage', permission] },
  });
  await pair.step('duplicate role', 'POST', '/admin/api/roles', {
    body: { code, name: 'Duplicate', permissions: [] },
  });
  await pair.step('unknown role permissions', 'PATCH', `/admin/api/roles/${code}`, { body: { permissions: ['fixture.missing'] } });
  await pair.step('update role', 'PATCH', `/admin/api/roles/${code}`, {
    body: { name: 'Updated fixture role', description: ' Role fixture ', permissions: ['self.accounts.write', permission] },
  });
  await pair.step('admin role immutable', 'PATCH', '/admin/api/roles/admin', { body: { name: 'Forbidden' } });
  await pair.step('built-in role not deletable', 'DELETE', '/admin/api/roles/user');
  return code;
}

async function administrationGuards(pair) {
  await pair.step('temporarily disable second fixture admin', 'PATCH', `/admin/api/users/${fixtureUsers.reviewer.id}`, { body: { disabled: true } });
  const lastAdmin = await pair.step('last active admin cannot be disabled', 'PATCH', `/admin/api/users/${fixtureUsers.admin.id}`, { body: { disabled: true } });
  assert.equal(lastAdmin.legacy.status, 400);
  await pair.step('restore second fixture admin', 'PATCH', `/admin/api/users/${fixtureUsers.reviewer.id}`, { body: { disabled: false } });
  const role = `delegator_${unique}`;
  await pair.step('create limited management role', 'POST', '/admin/api/roles', {
    body: { code: role, name: 'Fixture delegator', permissions: ['admin.users.manage', 'admin.roles.manage'] },
  });
  const email = `delegator-${unique}@example.test`;
  const created = await pair.step('create delegated manager', 'POST', '/admin/api/users', { body: { email, password: fixturePassword, role } });
  const login = await pair.step('login delegated manager', 'POST', '/auth/login', { auth: false, body: { email, password: fixturePassword } });
  const auth = [login.legacy.body.accessToken, login.modern.body.accessToken];
  const administrator = await pair.step('only built-in admin can assign administrator', 'POST', '/admin/api/users', {
    auth, body: { email: `forbidden-${unique}@example.test`, password: fixturePassword, role: 'admin' },
  });
  assert.equal(administrator.legacy.status, 403);
  const forbidden = await pair.step('cannot grant permissions outside actor set', 'POST', '/admin/api/roles', {
    auth, body: { code: `escalation_${unique}`, name: 'Forbidden escalation', permissions: ['admin.mail-services.manage'] },
  });
  assert.equal(forbidden.legacy.status, 403);
  await pair.step('remove delegated manager', 'DELETE', paths('/admin/api/users/', created));
  await pair.step('remove management fixture role', 'DELETE', `/admin/api/roles/${role}`);
}

async function users(pair, roleCode) {
  await pair.step('users list', 'GET', '/admin/api/users?page=1&pageSize=2');
  await pair.step('users filters', 'GET', '/admin/api/users?role=user&status=disabled&search=fixture');
  const email = `created-fixture-${unique}@example.test`;
  const created = await pair.step('create user', 'POST', '/admin/api/users', {
    body: { email, password: fixturePassword, role: roleCode, disabled: false },
  });
  assert.equal(created.legacy.status, 201);
  await pair.step('duplicate user email', 'POST', '/admin/api/users', { body: { email, password: fixturePassword } });
  await pair.step('assigned role cannot delete', 'DELETE', `/admin/api/roles/${roleCode}`);
  await pair.step('update user disabled', 'PATCH', paths('/admin/api/users/', created), { body: { disabled: true } });
  await pair.step('update user credentials', 'PATCH', paths('/admin/api/users/', created), {
    body: { email, role: roleCode, disabled: false, password: 'Changed-fixture-2026!' },
  });
  await pair.step('cannot delete self', 'DELETE', pair.selfIDs.map((id) => `/admin/api/users/${id}`));
  await pair.step('missing user update', 'PATCH', `/admin/api/users/${missingID}`, { body: { disabled: true } });
  return created;
}

async function invitationsAndApprovals(pair, createdUser, roleCode) {
  const invitation = await pair.step('create reusable invitation', 'POST', '/admin/api/invitations', {
    body: { role: roleCode, neverExpires: true, maxUses: 3 },
  });
  assert.equal(invitation.legacy.status, 201);
  await pair.step('invitation token stable', 'POST', paths('/admin/api/invitations/', invitation, '/token'));
  await pair.step('invitation list', 'GET', '/admin/api/invitations?pageSize=100');
  await pair.step('invitation registered users', 'GET', paths('/admin/api/invitations/', invitation, '/users'));
  await registerInvited(pair, invitation);
  await pair.step('revoke invitation', 'DELETE', paths('/admin/api/invitations/', invitation));
  await pair.step('missing invitation token', 'POST', `/admin/api/invitations/${missingID}/token`);
  const approval = await pair.step('request administrator approval', 'POST', '/admin/api/approvals', {
    sideBody: (side) => ({ type: 'promote_user_to_admin', targetUserId: createdUser[side].body.id, comment: 'Fixture request' }),
  });
  await pair.step('approval cannot review own request', 'POST', paths('/admin/api/approvals/', approval, '/review'), {
    body: { decision: 'approved' },
  });
  const reviewer = await pair.login('reviewer');
  await pair.step('approve administrator with second reviewer', 'POST', paths('/admin/api/approvals/', approval, '/review'), {
    auth: reviewer, body: { decision: 'approved', comment: 'Fixture accepted' },
  });
  await pair.step('approval cannot be reviewed twice', 'POST', paths('/admin/api/approvals/', approval, '/review'), {
    auth: reviewer, body: { decision: 'rejected' },
  });
  await pair.step('approval list', 'GET', '/admin/api/approvals?pageSize=100');
}

async function mailAndTemplates(pair) {
  await pair.step('list default mail service', 'GET', '/admin/api/mail-services');
  const created = await pair.step('create mail service', 'POST', '/admin/api/mail-services', {
    body: { name: `Fixture mail ${unique}`, host: 'mailpit', port: '1025', secure: false, username: 'fixture',
      password: 'fixture-mail-password', fromAddress: 'noreply@example.test', enabled: true },
  });
  assert.equal(created.legacy.status, 201);
  await pair.step('update mail service', 'PATCH', paths('/admin/api/mail-services/', created), {
    body: { name: `Fixture updated ${unique}`, enabled: false, password: 'replaced-password' },
  });
  await pair.step('list templates', 'GET', '/admin/api/email-templates');
  await pair.step('get notification template', 'GET', '/admin/api/email-templates/official-account.bound');
  await pair.step('template unknown variable', 'PATCH', '/admin/api/email-templates/official-account.bound', {
    body: { subject: 'Hello {{missing}}', body: 'Content' },
  });
  await pair.step('template rejects multiline subject', 'PATCH', '/admin/api/email-templates/official-account.bound', {
    body: { subject: 'Hello\nthere', body: 'Content' },
  });
  await pair.step('template disabled mail rejected', 'PATCH', '/admin/api/email-templates/official-account.bound', {
    sideBody: (side) => ({ subject: '{{accountCount}} new accounts', body: '{{userEmail}}\n{{accountEmails}}', mailServiceId: created[side].body.id }),
  });
  await pair.step('enable mail service', 'PATCH', paths('/admin/api/mail-services/', created), { body: { enabled: true } });
  await pair.step('customize template and sending service', 'PATCH', '/admin/api/email-templates/official-account.bound', {
    sideBody: (side) => ({ subject: '{{accountCount}} new accounts', body: '{{userEmail}}\n{{accountEmails}}', mailServiceId: created[side].body.id }),
  });
  await pair.step('delete custom mail service', 'DELETE', paths('/admin/api/mail-services/', created));
  await pair.step('deleted sender resets template reference', 'GET', '/admin/api/email-templates/official-account.bound');
}

async function mailboxCode(email, purpose) {
  const base = 'http://127.0.0.1:18025';
  for (let attempt = 0; attempt < 40; attempt++) {
    const listing = await fetch(`${base}/api/v1/messages?limit=100`).then((response) => response.json());
    const message = listing.messages?.find((item) => item.To?.some((recipient) => recipient.Address === email)
      && item.Subject.includes(purpose === 'registration' ? '注册' : '密码重置'));
    if (message) {
      const code = /^\d{6}/.exec(message.Subject)?.[0];
      assert.ok(code, 'verification email must start with a six-digit code');
      return code;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`No ${purpose} verification email for fixture recipient ${email}`);
}

async function registerInvited(pair, invitation) {
  const emails = { legacy: `legacy-invited-${unique}@example.test`, modern: `modern-invited-${unique}@example.test` };
  pair.alias(emails.legacy, emails.modern, '<invited fixture email>');
  await pair.step('send invited registration email', 'POST', '/auth/register/code', {
    auth: false, sideBody: (side) => ({ email: emails[side] }),
  });
  const codes = {};
  for (const side of ['legacy', 'modern']) codes[side] = await mailboxCode(emails[side], 'registration');
  const registered = await pair.step('register with signed invitation', 'POST', '/auth/register', {
    auth: false, sideBody: (side) => ({ email: emails[side], verificationCode: codes[side], password: fixturePassword,
      inviteToken: invitation[side].body.token }),
  });
  assert.equal(registered.legacy.status, 201);
  await pair.step('accepted invitation increments uses and records user', 'GET', paths('/admin/api/invitations/', invitation, '/users'));
  await pair.step('invitation use count updated', 'GET', '/admin/api/invitations?pageSize=100');
  await pair.step('remove invited fixture users', 'DELETE', [
    `/admin/api/users/${registered.legacy.body.user.id}`, `/admin/api/users/${registered.modern.body.user.id}`,
  ]);
}

async function verificationFlow(pair) {
  await pair.step('unknown password-reset email indistinguishable', 'POST', '/auth/password-reset/code', {
    auth: false, body: { email: `unknown-${unique}@example.test` },
  });
  await pair.step('existing registration email rejected', 'POST', '/auth/register/code', {
    auth: false, body: { email: fixtureUsers.admin.email },
  });
  const emails = { legacy: `legacy-register-${unique}@example.test`, modern: `modern-register-${unique}@example.test` };
  pair.alias(emails.legacy, emails.modern, '<fixture registration email>');
  await pair.step('send registration email', 'POST', '/auth/register/code', { auth: false, sideBody: (side) => ({ email: emails[side] }) });
  await pair.step('registration resend cooldown', 'POST', '/auth/register/code', { auth: false, sideBody: (side) => ({ email: emails[side] }) });
  const codes = {};
  for (const side of ['legacy', 'modern']) codes[side] = await mailboxCode(emails[side], 'registration');
  const scrubEmail = (body) => ({ ...body, user: { ...body.user, email: '<fixture registration email>' } });
  const registered = await pair.step('register with received code', 'POST', '/auth/register', {
    auth: false, sideBody: (side) => ({ email: emails[side], verificationCode: codes[side], password: fixturePassword }), normalize: scrubEmail,
  });
  assert.equal(registered.legacy.status, 201);
  await pair.step('registration code cannot replay', 'POST', '/auth/register', {
    auth: false, sideBody: (side) => ({ email: emails[side], verificationCode: codes[side], password: fixturePassword }),
  });
  await pair.step('send password reset email', 'POST', '/auth/password-reset/code', { auth: false, sideBody: (side) => ({ email: emails[side] }) });
  for (const side of ['legacy', 'modern']) codes[side] = await mailboxCode(emails[side], 'password-reset');
  await pair.step('reset password consumes code and revokes sessions', 'POST', '/auth/password-reset', {
    auth: false, sideBody: (side) => ({ email: emails[side], verificationCode: codes[side], newPassword: 'Reset-fixture-2026!' }),
  });
  await pair.step('reset revokes previous refresh token', 'POST', '/auth/refresh', {
    auth: false, sideBody: (side) => ({ refreshToken: registered[side].body.refreshToken }),
  });
  const resetLogin = await pair.step('reset password allows new login', 'POST', '/auth/login', {
    auth: false, sideBody: (side) => ({ email: emails[side], password: 'Reset-fixture-2026!' }), normalize: scrubEmail,
  });
  await pair.step('change own password with current password', 'PATCH', '/admin/api/profile/password', {
    auth: [resetLogin.legacy.body.accessToken, resetLogin.modern.body.accessToken],
    body: { currentPassword: 'Reset-fixture-2026!', newPassword: 'Profile-fixture-2026!' },
  });
  await pair.step('changed profile password rejects previous password', 'POST', '/auth/login', {
    auth: false, sideBody: (side) => ({ email: emails[side], password: 'Reset-fixture-2026!' }),
  });
  await pair.step('changed profile password allows new login', 'POST', '/auth/login', {
    auth: false, sideBody: (side) => ({ email: emails[side], password: 'Profile-fixture-2026!' }), normalize: scrubEmail,
  });
  await pair.step('profile password change preserves existing refresh session', 'POST', '/auth/refresh', {
    auth: false, sideBody: (side) => ({ refreshToken: resetLogin[side].body.refreshToken }), normalize: scrubEmail,
  });
  await pair.step('remove registration fixtures', 'DELETE', paths('/admin/api/users/', {
    legacy: { body: { id: registered.legacy.body.user.id } }, modern: { body: { id: registered.modern.body.user.id } },
  }), { normalize: (body) => ({ ...body, email: '<fixture registration email>' }) });
  await verificationAttemptLimit(pair);
}

async function verificationAttemptLimit(pair) {
  const emails = { legacy: `legacy-guesses-${unique}@example.test`, modern: `modern-guesses-${unique}@example.test` };
  await pair.step('send rate-limit fixture code', 'POST', '/auth/register/code', { auth: false, sideBody: (side) => ({ email: emails[side] }) });
  const codes = {};
  for (const side of ['legacy', 'modern']) codes[side] = await mailboxCode(emails[side], 'registration');
  for (let attempt = 1; attempt <= 5; attempt++) {
    const response = await pair.step(`verification failed attempt ${attempt}`, 'POST', '/auth/register', {
      auth: false, sideBody: (side) => ({ email: emails[side], password: fixturePassword,
        verificationCode: codes[side] === '999999' ? '000000' : '999999' }),
    });
    assert.equal(response.legacy.status, 400);
  }
  const exhausted = await pair.step('five wrong attempts invalidate correct code', 'POST', '/auth/register', {
    auth: false, sideBody: (side) => ({ email: emails[side], password: fixturePassword, verificationCode: codes[side] }),
  });
  assert.equal(exhausted.legacy.status, 400);
}

async function copyRefreshRows(from, to) {
  const source = await fixtureDatabase(from);
  const target = await fixtureDatabase(to);
  try {
    const { rows } = await source.query('SELECT * FROM refresh_tokens WHERE "userId" = $1', [fixtureUsers.admin.id]);
    for (const row of rows) {
      await target.query(`INSERT INTO refresh_tokens (id,"userId","tokenHash","expiresAt","revokedAt","createdAt")
        VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (id) DO UPDATE SET "revokedAt"=EXCLUDED."revokedAt"`,
      [row.id, row.userId, row.tokenHash, row.expiresAt, row.revokedAt, row.createdAt]);
    }
  } finally { await source.end(); await target.end(); }
}

async function concurrentRefresh(pair) {
  const login = await pair.step('login for concurrent refresh test', 'POST', '/auth/login', {
    auth: false, body: { email: fixtureUsers.admin.email, password: fixturePassword },
  });
  for (const side of ['legacy', 'modern']) {
    const responses = await Promise.all(Array.from({ length: 8 }, () => request(pair.urls[side], 'POST', '/auth/refresh', {
      body: { refreshToken: login[side].body.refreshToken },
    })));
    assert.ok(responses.every((response) => response.status === 201), `${side}: every simultaneous retry must succeed`);
    assert.equal(new Set(responses.map((response) => response.body.refreshToken)).size, 1, `${side}: concurrent retries must share one successor`);
  }
  pair.results.push({ label: 'eight simultaneous refresh requests reuse one live successor', status: 201 });
  console.log('PASS eight simultaneous refresh requests reuse one live successor');
}

async function refreshMigration(pair) {
  const login = await request(pair.urls.legacy, 'POST', '/auth/login', {
    body: { email: fixtureUsers.admin.email, password: fixturePassword },
  });
  assert.equal(login.status, 201);
  await copyRefreshRows('legacy', 'admin_go');
  const previous = login.body.refreshToken;
  const rotated = await request(pair.urls.modern, 'POST', '/auth/refresh', { body: { refreshToken: previous } });
  assert.equal(rotated.status, 201, 'Go must rotate the legacy refresh token after database migration');
  await copyRefreshRows('admin_go', 'legacy');
  await copyRecovery('modern', 'legacy', previous);
  const recovered = await request(pair.urls.legacy, 'POST', '/auth/refresh', { body: { refreshToken: previous } });
  assert.equal(recovered.status, 201, 'Legacy must read Go encrypted Redis recovery record');
  assert.equal(recovered.body.refreshToken, rotated.body.refreshToken, 'lost-response recovery must reuse exact successor');
  const rerotated = await request(pair.urls.legacy, 'POST', '/auth/refresh', { body: { refreshToken: rotated.body.refreshToken } });
  assert.equal(rerotated.status, 201);
  await copyRefreshRows('legacy', 'admin_go');
  await copyRecovery('legacy', 'modern', rotated.body.refreshToken);
  const recoveredByGo = await request(pair.urls.modern, 'POST', '/auth/refresh', { body: { refreshToken: rotated.body.refreshToken } });
  assert.equal(recoveredByGo.status, 201, 'Go must read legacy encrypted Redis recovery record');
  assert.equal(recoveredByGo.body.refreshToken, rerotated.body.refreshToken);
  const logout = await pair.step('logout lost-response token revokes successor', 'POST', '/auth/logout', {
    auth: false, body: { refreshToken: rotated.body.refreshToken },
  });
  assert.equal(logout.legacy.status, 201);
  const rejected = await pair.step('logout successor cannot be revived', 'POST', '/auth/refresh', {
    auth: false, body: { refreshToken: rerotated.body.refreshToken },
  });
  assert.equal(rejected.legacy.status, 401);
  pair.results.push({ label: 'cross-language refresh rotation and AES-GCM recovery in both directions', status: 201 });
  console.log('PASS cross-language refresh rotation and AES-GCM recovery in both directions');
}

async function copyRecovery(from, to, token) {
  const clients = { legacy: new Redis({ host: '127.0.0.1', port: 16379 }), modern: new Redis({ host: '127.0.0.1', port: 16380 }) };
  try {
    const key = `auth:refresh-recovery:${createHash('sha256').update(token).digest('hex')}`;
    const ciphertext = await clients[from].get(key);
    const ttl = await clients[from].pttl(key);
    assert.ok(ciphertext && ttl > 0, 'rotation must persist bounded encrypted recovery');
    assert.ok(!ciphertext.includes(token), 'Redis recovery cannot contain the original token');
    await clients[to].set(key, ciphertext, 'PX', ttl);
  } finally { await Promise.all(Object.values(clients).map((client) => client.quit())); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const pair = await createPair();
  await runIdentity(pair);
  console.log(`Identity parity: ${pair.results.length} checks completed`);
}
