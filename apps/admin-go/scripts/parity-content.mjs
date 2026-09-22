import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

const missingID = '10000000-0000-4000-8000-000000000099';
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aKTcAAAAASUVORK5CYII=',
  'base64',
);

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function archive(name = 'example/SKILL.md', content = '# Fixture\nUse this simulated skill.') {
  const nameBytes = Buffer.from(name);
  const data = Buffer.from(content);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50);
  local.writeUInt16LE(20, 4);
  local.writeUInt32LE(crc32(data), 14);
  local.writeUInt32LE(data.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(nameBytes.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt32LE(crc32(data), 16);
  central.writeUInt32LE(data.length, 20);
  central.writeUInt32LE(data.length, 24);
  central.writeUInt16LE(nameBytes.length, 28);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.length + nameBytes.length, 12);
  end.writeUInt32LE(local.length + nameBytes.length + data.length, 16);
  return Buffer.concat([local, nameBytes, data, central, nameBytes, end]);
}

function paths(response, base, suffix = '') {
  return [response.legacy.body.id, response.modern.body.id].map((id) => `${base}/${id}${suffix}`);
}

async function expected(pair, label, method, path, options = {}, status = 200) {
  const result = await pair.step(`content: ${label}`, method, path, options);
  if (process.env.PARITY_COLLECT === '1') {
    for (const side of ['legacy', 'modern']) {
      if (result[side].status !== status) pair.results.push({
        label: `${label}: ${side} expected ${status}, got ${result[side].status}`, failed: true,
      });
    }
  } else {
    assert.equal(result.legacy.status, status, `${label}: legacy status`);
    assert.equal(result.modern.status, status, `${label}: Go status`);
  }
  return result;
}

async function anonymousRead(pair, path) {
  return expected(pair, `public ${path}`, 'GET', path, { auth: false });
}

function checkHeader(pairResponse, name, value) {
  assert.equal(pairResponse.legacy.headers[name], value);
  assert.equal(pairResponse.modern.headers[name], value);
}

async function announcements(pair) {
  const state = await anonymousRead(pair, '/announcements/current');
  checkHeader(state, 'cache-control', 'no-store');
  await expected(pair, 'read announcement', 'GET', '/admin/api/announcement');
  const body = {
    contentZh: ' 模拟公告 ', contentEn: ' Test announcement ', link: 'https://example.test/news', enabled: true,
    textColor: '#aabbcc', backgroundColor: '#112233', darkTextColor: '#ddeeff', darkBackgroundColor: '#334455',
    scrollDurationSeconds: 30,
  };
  await expected(pair, 'publish announcement', 'PATCH', '/admin/api/announcement', { body });
  const visible = await anonymousRead(pair, '/announcements/current');
  assert.equal(visible.modern.body.content, '模拟公告');
  const oldClient = { ...body };
  delete oldClient.darkTextColor;
  delete oldClient.darkBackgroundColor;
  await expected(pair, 'old announcement client', 'PATCH', '/admin/api/announcement', { body: oldClient });
  for (const patch of [{ contentEn: ' ' }, { darkTextColor: null }, { scrollDurationSeconds: 4 }]) {
    await expected(pair, 'invalid announcement', 'PATCH', '/admin/api/announcement', { body: { ...body, ...patch } }, 400);
  }
  await expected(pair, 'disabled announcement', 'PATCH', '/admin/api/announcement', { body: { ...body, enabled: false } });
  const hidden = await anonymousRead(pair, '/announcements/current');
  assert.equal(hidden.modern.body.content, '');
  const click = { deviceId: randomUUID(), platform: 'windows', link: body.link, announcementUpdatedAt: '2026-09-01T00:00:00.000Z' };
  await expected(pair, 'anonymous click', 'POST', '/announcements/clicks', { body: click, auth: false });
  await expected(pair, 'authenticated click', 'POST', '/announcements/clicks/authenticated', { body: click });
  await expected(pair, 'click overview', 'GET', '/admin/api/announcement/clicks/overview');
  await expected(pair, 'click search', 'GET', `/admin/api/announcement/clicks?search=${click.deviceId}&platform=windows&page=1&pageSize=1`);
  await expected(pair, 'invalid click', 'POST', '/announcements/clicks', { body: { ...click, deviceId: 'bad' }, auth: false }, 400);
}

async function notificationsAndFAQs(pair) {
  const notification = {
    titleZh: ' 测试通知 ', titleEn: ' Test notification ', contentZh: ' 通知正文 ', contentEn: ' Body ',
    link: 'https://example.test/notice', linkLabelZh: ' 打开 ', linkLabelEn: ' Open ', enabled: true,
    publishedAt: '2026-09-01T09:00:00+08:00',
  };
  const created = await expected(pair, 'create notification', 'POST', '/admin/api/notifications', { body: notification }, 201);
  await anonymousRead(pair, '/notifications/recent');
  await expected(pair, 'notification list', 'GET', '/admin/api/notifications');
  await expected(pair, 'hide notification', 'PATCH', paths(created, '/admin/api/notifications'), { body: { ...notification, enabled: false } });
  await anonymousRead(pair, '/notifications/recent');
  await expected(pair, 'blank notification', 'POST', '/admin/api/notifications', { body: { ...notification, titleEn: ' ' } }, 400);
  await expected(pair, 'remove notification', 'DELETE', paths(created, '/admin/api/notifications'));
  await expected(pair, 'missing notification', 'DELETE', paths(created, '/admin/api/notifications'), {}, 404);
  const faq = { questionZh: ' 问题 ', questionEn: ' Question ', answerZh: ' 回答 ', answerEn: ' Answer ', enabled: true, sortOrder: -2 };
  const createdFAQ = await expected(pair, 'create FAQ', 'POST', '/admin/api/faqs', { body: faq }, 201);
  await anonymousRead(pair, '/faqs');
  await expected(pair, 'FAQ list', 'GET', '/admin/api/faqs');
  await expected(pair, 'disable FAQ', 'PATCH', paths(createdFAQ, '/admin/api/faqs'), { body: { ...faq, enabled: false, sortOrder: 4 } });
  await anonymousRead(pair, '/faqs');
  await expected(pair, 'blank FAQ', 'POST', '/admin/api/faqs', { body: { ...faq, answerZh: ' ' } }, 400);
  await expected(pair, 'remove FAQ', 'DELETE', paths(createdFAQ, '/admin/api/faqs'));
  await expected(pair, 'missing FAQ', 'PATCH', paths(createdFAQ, '/admin/api/faqs'), { body: faq }, 404);
}

async function promptPlugins(pair, nonownerAuth) {
  await anonymousRead(pair, '/prompt-plugins');
  const body = { name: ' Fixture plugin ', version: ' 1.0 ', type: 'filter', text: ' 模拟内容 ' };
  const created = await expected(pair, 'create prompt plugin', 'POST', '/prompt-plugins', { body }, 201);
  await expected(pair, 'plugin publisher permission', 'PATCH', paths(created, '/prompt-plugins'),
    { body: { ...body, version: '2.0' }, auth: nonownerAuth }, 403);
  await expected(pair, 'install prompt plugin', 'GET', paths(created, '/prompt-plugins', '/install'), { auth: false });
  await anonymousRead(pair, '/prompt-plugins');
  await expected(pair, 'same plugin release', 'PATCH', paths(created, '/prompt-plugins'), { body }, 400);
  await expected(pair, 'new plugin release', 'PATCH', paths(created, '/prompt-plugins'), { body: { ...body, version: '2.0', type: 'injection', text: 'New injection' } });
  await expected(pair, 'plugin admin search', 'GET', '/admin/api/prompt-plugins?search=Fixture&pageSize=1');
  await expected(pair, 'plugin admin edit', 'PATCH', paths(created, '/admin/api/prompt-plugins'), { body: { name: 'Renamed fixture' } });
  await expected(pair, 'empty plugin edit', 'PATCH', paths(created, '/admin/api/prompt-plugins'), { body: {} });
  for (const patch of [{ version: 'bad version' }, { type: 'filter', text: '😀'.repeat(501) }, { name: ' ' }]) {
    await expected(pair, 'invalid prompt plugin', 'POST', '/prompt-plugins', { body: { ...body, ...patch } }, 400);
  }
  await expected(pair, 'remove plugin', 'DELETE', paths(created, '/admin/api/prompt-plugins'));
  await expected(pair, 'missing plugin', 'GET', paths(created, '/prompt-plugins', '/install'), { auth: false }, 404);
}

function skillForm(options = {}) {
  const form = new FormData();
  form.set('title', options.title ?? ' Fixture skill ');
  form.set('description', ' Example skill description ');
  form.set('version', options.version ?? '1.0');
  if (options.archive !== false) form.set('archive', new Blob([options.archive ?? archive()], { type: 'application/zip' }), 'example.zip');
  if (options.preview !== false) form.set('preview', new Blob([options.preview ?? png], { type: 'image/png' }), 'preview.png');
  return form;
}

async function skills(pair, nonownerAuth) {
  await anonymousRead(pair, '/skills');
  const created = await expected(pair, 'upload skill', 'POST', '/skills', { sideBody: () => skillForm() }, 201);
  assert.equal(created.modern.body.official, true);
  await expected(pair, 'skill publisher permission', 'PATCH', paths(created, '/skills'),
    { sideBody: () => skillForm({ version: '2.0' }), auth: nonownerAuth }, 403);
  const download = await expected(pair, 'download skill archive', 'GET', paths(created, '/skills', '/download'), { auth: false, binary: true });
  assert.deepEqual(download.modern.body, archive());
  checkHeader(download, 'content-type', 'application/zip');
  checkHeader(download, 'cache-control', 'private, no-store');
  checkHeader(download, 'content-disposition', 'attachment; filename="example.zip"');
  assert.equal(download.legacy.headers['x-skill-sha256'], download.modern.headers['x-skill-sha256']);
  const preview = await expected(pair, 'skill preview', 'GET', paths(created, '/skills', '/preview'), { auth: false, binary: true });
  assert.deepEqual(preview.modern.body, png);
  checkHeader(preview, 'cache-control', 'public, max-age=86400');
  await expected(pair, 'same skill release', 'PATCH', paths(created, '/skills'), { sideBody: () => skillForm() }, 400);
  await expected(pair, 'new skill release', 'PATCH', paths(created, '/skills'), { sideBody: () => skillForm({ version: '2.0', preview: false }) });
  await expected(pair, 'retained preview', 'GET', paths(created, '/skills', '/preview'), { auth: false, binary: true });
  for (const options of [{ archive: false }, { archive: archive('../SKILL.md') }, { preview: Buffer.from('invalid') }, { title: ' ' }]) {
    await expected(pair, 'invalid upload', 'POST', '/skills', { sideBody: () => skillForm(options) }, 400);
  }
  await expected(pair, 'skills admin search', 'GET', '/admin/api/skills?search=Fixture&page=1e0&pageSize=10');
  await expected(pair, 'skill admin edit', 'PATCH', paths(created, '/admin/api/skills'), { body: { title: 'Renamed skill', version: '3.0' } });
  await expected(pair, 'empty skill edit', 'PATCH', paths(created, '/admin/api/skills'), { body: {} });
  await expected(pair, 'remove skill', 'DELETE', paths(created, '/admin/api/skills'));
  await expected(pair, 'missing skill', 'GET', paths(created, '/skills', '/download'), { auth: false }, 404);
}

function feedbackForm(options = {}) {
  const form = new FormData();
  form.set('content', options.content ?? ' 模拟反馈内容 ');
  form.set('version', '1.2.3');
  form.set('platform', ' Windows 11 ');
  if (options.email !== false) form.set('email', 'feedback@example.test');
  if (options.image !== false) form.append('images', new Blob([options.image ?? png], { type: 'image/png' }), 'feedback.png');
  return form;
}

async function feedback(pair) {
  const created = await expected(pair, 'anonymous feedback', 'POST', '/feedback', { auth: false, sideBody: () => feedbackForm() }, 201);
  const detailed = await expected(pair, 'feedback detail', 'GET', paths(created, '/admin/api/feedback'));
  const imagePaths = [detailed.legacy.body, detailed.modern.body].map((item) =>
    `/admin/api/feedback/${item.id}/attachments/${item.attachments[0].id}`);
  const attachment = await expected(pair, 'feedback attachment', 'GET', imagePaths, { binary: true });
  assert.deepEqual(attachment.modern.body, png);
  checkHeader(attachment, 'content-disposition', 'inline');
  checkHeader(attachment, 'cache-control', 'private, max-age=300');
  await expected(pair, 'authenticated feedback', 'POST', '/feedback/authenticated', { sideBody: () => feedbackForm({ image: false }) }, 201);
  await expected(pair, 'feedback list', 'GET', '/admin/api/feedback?page=1&pageSize=10');
  await expected(pair, 'feedback invalid image', 'POST', '/feedback', { auth: false, sideBody: () => feedbackForm({ image: Buffer.from('invalid') }) }, 400);
  await expected(pair, 'feedback blank content', 'POST', '/feedback', { auth: false, sideBody: () => feedbackForm({ content: ' ' }) }, 400);
  await expected(pair, 'feedback no subject', 'POST', paths(created, '/admin/api/feedback', '/email'), { body: { subject: ' ', content: 'Reply' } }, 400);
  await expected(pair, 'feedback SMTP reply', 'POST', paths(created, '/admin/api/feedback', '/email'),
    { body: { subject: 'Fixture feedback reply', content: 'Thanks for the simulated feedback.' } }, 201);
  const replied = await expected(pair, 'feedback reply metadata', 'GET', paths(created, '/admin/api/feedback'));
  assert.ok(replied.modern.body.lastRepliedAt);
  const noEmail = await expected(pair, 'feedback without email', 'POST', '/feedback', { auth: false, sideBody: () => feedbackForm({ image: false, email: false }) }, 201);
  await expected(pair, 'cannot reply without address', 'POST', paths(noEmail, '/admin/api/feedback', '/email'), { body: { subject: 'Reply', content: 'Thanks' } }, 400);
  await expected(pair, 'missing feedback', 'GET', `/admin/api/feedback/${missingID}`, {}, 404);
}

async function settings(pair) {
  await expected(pair, 'home settings', 'GET', '/admin/api/codex-home-presets');
  const presets = [
    { id: 'first', name: ' First ', windowsPath: ' C:\\codex ', macosPath: ' /tmp/codex ', enabled: true, sortOrder: 2 },
    { id: 'second', name: 'Second', windowsPath: 'D:\\codex', macosPath: '/opt/codex', enabled: false, sortOrder: 1 },
  ];
  await expected(pair, 'save home settings', 'PATCH', '/admin/api/codex-home-presets', { body: { presets } });
  await anonymousRead(pair, '/codex-home-presets?platform=windows');
  await anonymousRead(pair, '/codex-home-presets?platform=macos');
  await expected(pair, 'duplicate home preset', 'PATCH', '/admin/api/codex-home-presets', { body: { presets: [presets[0], presets[0]] } }, 400);
  const chat = await expected(pair, 'chat settings', 'GET', '/admin/api/chat-settings');
  checkHeader(chat, 'cache-control', 'no-store');
  const policy = { ...chat.legacy.body, threadPageSize: 25, titleSettings: { model: ' gpt-5.6-luna ', effort: 'medium' } };
  await expected(pair, 'save chat settings', 'PATCH', '/admin/api/chat-settings', { body: policy });
  await anonymousRead(pair, '/chat/title-settings');
  await expected(pair, 'invalid chat setting', 'PATCH', '/admin/api/chat-settings', { body: { ...policy, relayMaxMbPerSecond: 0 } }, 400);
  await expected(pair, 'incomplete chat settings', 'PATCH', '/admin/api/chat-settings', { body: {} }, 400);
  await expected(pair, 'currency settings', 'GET', '/admin/api/currency');
  await expected(pair, 'clear currency key', 'PATCH', '/admin/api/currency', { body: { currencies: [{ code: 'EUR', name: ' Euro ' }], clearApiKey: true } });
  await anonymousRead(pair, '/currency-rates');
  await expected(pair, 'duplicate currency', 'PATCH', '/admin/api/currency', { body: { currencies: [{ code: 'EUR', name: 'Euro' }, { code: 'EUR', name: 'Euro' }] } }, 400);
  await expected(pair, 'USD currency', 'PATCH', '/admin/api/currency', { body: { currencies: [{ code: 'USD', name: 'Dollar' }] } }, 400);
  await expected(pair, 'save encrypted key', 'PATCH', '/admin/api/currency', { body: { apiKey: 'fixture-key', currencies: [] } });
  await anonymousRead(pair, '/currency-rates');
  const currencies = [{ code: 'EUR', name: 'Euro' }, { code: 'CNY', name: '人民币' }];
  await expected(pair, 'configure simulated currency API', 'PATCH', '/admin/api/currency',
    { body: { apiKey: 'fixture-key', currencies } });
  const rates = await anonymousRead(pair, '/currency-rates');
  assert.deepEqual(rates.modern.body.currencies, [
    { code: 'EUR', name: 'Euro', rate: 0.9 }, { code: 'CNY', name: '人民币', rate: 7.2 },
  ]);
  await anonymousRead(pair, '/currency-rates');
  const cached = await expected(pair, 'currency cache metadata', 'GET', '/admin/api/currency');
  assert.equal(cached.modern.body.hasApiKey, true);
  assert.equal(cached.modern.body.cachedRates.length, 2);
  await expected(pair, 'configure simulated currency failure', 'PATCH', '/admin/api/currency',
    { body: { apiKey: 'fixture-fail', currencies } });
  await expected(pair, 'currency upstream outage', 'GET', '/currency-rates', { auth: false }, 503);
  await expected(pair, 'clear simulated currency settings', 'PATCH', '/admin/api/currency',
    { body: { clearApiKey: true, currencies: [] } });
}

async function analytics(pair) {
  const deviceId = randomUUID();
  const event = { deviceId, platform: 'windows', appVersion: ' 1.2.3 ', eventType: 'installation' };
  await expected(pair, 'installation', 'POST', '/telemetry/installations', { auth: false, body: event });
  await expected(pair, 'activity', 'POST', '/telemetry/installations', { auth: false, body: { ...event, appVersion: ' ', eventType: 'activity' } });
  await expected(pair, 'base URL event', 'POST', '/telemetry/installations', { auth: false, body: { ...event, platform: 'macos', eventType: 'base_url_changed' } });
  await expected(pair, 'telemetry overview', 'GET', '/admin/api/telemetry/overview');
  await expected(pair, 'installations search', 'GET', `/admin/api/telemetry/installations?search=${deviceId}&platform=macos`);
  await expected(pair, 'events search', 'GET', `/admin/api/telemetry/events?search=${deviceId}&eventType=activity`);
  await expected(pair, 'invalid telemetry', 'POST', '/telemetry/installations', { auth: false, body: { ...event, eventType: 'invalid' } }, 400);
  for (const days of [7, 30, 90]) await expected(pair, `dashboard ${days} days`, 'GET', `/admin/api/dashboard/overview?days=${days}`);
  await expected(pair, 'invalid dashboard range', 'GET', '/admin/api/dashboard/overview?days=8', {}, 400);
}

async function transportErrors(pair) {
  for (const body of ['{', '{}{}', 'null', 'true', '1', '"hello"', '{"x":1,}']) {
    await expected(pair, `legacy JSON parser ${body}`, 'POST', '/announcements/clicks',
      { body: Buffer.from(body), headers: { 'Content-Type': 'application/json' }, auth: false }, 404);
  }
  for (const body of ['[]', '[{}]']) {
    await expected(pair, `array DTO ${body}`, 'POST', '/announcements/clicks',
      { body: Buffer.from(body), headers: { 'Content-Type': 'application/json' }, auth: false }, 400);
  }
  await expected(pair, 'JSON limit', 'POST', '/announcements/clicks', {
    auth: false, body: Buffer.from(`{"large":"${'a'.repeat(12 * 1024 * 1024)}"}`),
    headers: { 'Content-Type': 'application/json' },
  }, 404);
  await expected(pair, 'unknown JSON field order', 'POST', '/announcements/clicks',
    { auth: false, body: { zzz: true, aaa: false } }, 400);
  await expected(pair, 'multipart duplicate archive', 'POST', '/skills', { sideBody: () => {
    const form = skillForm({ preview: false });
    form.append('archive', new Blob([archive()]), 'second.zip');
    return form;
  } }, 400);
  await expected(pair, 'multipart too many skill files', 'POST', '/skills', { sideBody: () => {
    const form = skillForm(); form.append('other', new Blob([png]), 'third.png'); return form;
  } }, 400);
  await expected(pair, 'multipart archive size limit', 'POST', '/skills',
    { sideBody: () => skillForm({ archive: Buffer.alloc(1024 * 1024 + 1) }) }, 413);
  await expected(pair, 'multipart field size limit', 'POST', '/skills', { sideBody: () => {
    const form = skillForm(); form.set('description', 'a'.repeat(1024 * 1024 + 1)); return form;
  } }, 400);
  await expected(pair, 'multipart feedback count limit', 'POST', '/feedback', { auth: false, sideBody: () => {
    const form = feedbackForm({ image: false });
    for (let index = 0; index < 5; index += 1) form.append('images', new Blob([png], { type: 'image/png' }), 'image.png');
    return form;
  } }, 400);
  await expected(pair, 'multipart feedback image limit', 'POST', '/feedback',
    { auth: false, sideBody: () => feedbackForm({ image: Buffer.alloc(5 * 1024 * 1024 + 1) }) }, 413);
  await expected(pair, 'feedback MIME filter precedes DTO', 'POST', '/feedback', { auth: false, sideBody: () => {
    const form = new FormData(); form.append('images', new Blob([png]), 'image.bin'); return form;
  } }, 400);
}

export async function runContent(pair) {
  const userAuth = await pair.login('user');
  await announcements(pair);
  await notificationsAndFAQs(pair);
  await promptPlugins(pair, userAuth);
  await skills(pair, userAuth);
  await feedback(pair);
  await settings(pair);
  await analytics(pair);
  await transportErrors(pair);
  for (const path of ['/admin/api/announcement', '/admin/api/skills', '/admin/api/dashboard/overview']) {
    await expected(pair, `anonymous forbidden ${path}`, 'GET', path, { auth: false }, 401);
  }
  await expected(pair, 'regular user admin permission', 'GET', '/admin/api/skills', { auth: userAuth }, 403);
}
