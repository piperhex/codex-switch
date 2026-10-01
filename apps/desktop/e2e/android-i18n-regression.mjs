import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { adb, activity, applicationId, apiUrl, appErrorLogs, output, prepare, serverState,
  waitFor, waitText, tap as tapControl, input, screenshot, nodes, hasText } from './android-chat-driver.mjs';

const copy = {
  zh: { language: '语言', name: '简体中文', settings: '设置', chat: '聊天', message: '聊天消息' },
  en: { language: 'Language', name: 'English', settings: 'Settings', chat: 'Chat', message: 'Chat message' },
  ru: { language: 'Язык', name: 'Русский', settings: 'Настройки', chat: 'Чат', message: 'Сообщение в чате' },
};
const report = { startedAt: new Date().toISOString(), cases: [] };
const draft = 'Keep this draft unchanged';
const ready = () => waitFor(async () => (await hasText('Relay')) || (await hasText('P2P')), 'chat connected');

async function tryTap(label, options) {
  try { await tapControl(label, options); return true; }
  catch (error) {
    if (String(error).includes('Visible control not found:')) return false;
    throw error;
  }
}

async function tap(label, options) {
  await waitFor(async () => {
    const current = await nodes();
    const skip = current.find(node => ['跳过此版本', 'Skip this version', 'Пропустить эту версию']
      .includes(node['content-desc']));
    if (skip) { await tryTap(skip['content-desc']); return false; }
    if (current.some(node => node.text === label || node['content-desc'] === label)) return tryTap(label, options);
    // A startup update dialog can cover the first tap on the login language picker.
    const picker = current.find(node => Object.values(copy).some(value =>
      node['content-desc'] === `${value.language} ${value.name}`));
    if (picker && Object.values(copy).some(value => value.name === label)) await tryTap(picker['content-desc']);
    return false;
  }, label);
}

async function waitLogin(label) {
  await waitFor(async () => {
    const current = await nodes();
    const skip = current.find(node => ['跳过此版本', 'Skip this version', 'Пропустить эту версию']
      .includes(node['content-desc']));
    if (skip) await tryTap(skip['content-desc']);
    return current.some(node => node.text === label || node['content-desc'] === label);
  }, label);
}

async function check(name, action) {
  console.log(`RUN ${name}`);
  try {
    await action();
    await screenshot(name);
    report.cases.push({ name, passed: true });
    console.log(`PASS ${name}`);
  } catch (error) {
    report.cases.push({ name, passed: false, error: String(error) });
    await screenshot(`${name}-failed`);
    throw error;
  }
}

async function chooseLanguage(from, to) {
  await tap(from.settings, { last: true });
  await tap(`${from.language}，${from.name}`);
  await tap(to.name);
  await waitText(`${to.language}，${to.name}`);
}

async function assertDraft(language) {
  await tap(language.chat, { last: true });
  await waitText(language.message);
  const field = (await nodes()).find(node => node['content-desc'] === language.message);
  assert.equal(field?.text, draft);
}

try {
  report.device = await prepare();
  await check('01-login-languages', async () => {
    await tap('Русский');
    await waitLogin('Войти');
    await screenshot('login-russian');
    await tap('Язык Русский');
    await tap('English');
    await waitText('Sign in');
    await screenshot('login-english');
    await tap('Language English');
    await tap('简体中文');
    await waitText('云端服务器地址');
    await input(0, apiUrl);
    await input(1, 'mobile-test@example.test');
    await input(2, 'local-test');
    await adb('shell', 'input', 'keyevent', 'KEYCODE_BACK');
    await tap('登录并查看');
    await waitText('同意并登录');
    await tap('同意并登录');
    await waitText('聊天消息');
  });
  await check('02-connect-and-preserve-draft', async () => {
    await tap('聊天', { last: true });
    await waitText('聊天消息');
    await ready();
    await tap('打开聊天列表');
    await tap('移动端聊天体验');
    await waitText('帮我整理今天的工作计划');
    await input('聊天消息', draft);
    await adb('shell', 'input', 'keyevent', 'KEYCODE_BACK');
  });
  const before = await serverState();
  await check('03-switch-english-russian-chinese', async () => {
    let previous = copy.zh;
    for (const [code, language] of Object.entries(copy).filter(([code]) => code !== 'zh')
      .concat([['zh', copy.zh]])) {
      await chooseLanguage(previous, language);
      if (code === 'ru') {
        const interval = (await nodes()).find(node => node.text === '30 минут');
        assert.ok(interval && interval.rect[2] > interval.rect[0], 'refresh interval remains visible');
      }
      await screenshot(`settings-${code}`);
      await assertDraft(language);
      const after = await serverState();
      assert.equal(after.mobileConnections, before.mobileConnections);
      assert.equal(after.connectedMobiles, 1);
      assert.deepEqual(after.operations.filter(entry => ['send', 'steer', 'composerSet'].includes(entry.operation)),
        before.operations.filter(entry => ['send', 'steer', 'composerSet'].includes(entry.operation)));
      assert.deepEqual(after.composer.settings, before.composer.settings);
      await screenshot(`chat-${code}`);
      previous = language;
    }
  });
  await check('04-send-unchanged-content-in-russian', async () => {
    await chooseLanguage(copy.zh, copy.ru);
    await assertDraft(copy.ru);
    await tap('Отправить сообщение');
    await waitFor(async () => (await serverState()).operations.some(entry => entry.operation === 'send'), 'send');
    const sent = (await serverState()).operations.findLast(entry => entry.operation === 'send');
    assert.equal(sent.threadId, 'demo-chat');
    assert.equal(sent.text, draft);
    for (const field of ['model', 'effort', 'access', 'speed']) {
      assert.equal(sent[field], before.composer.settings[field]);
    }
    report.sent = sent;
    await waitText('const connected = true;');
    await waitText(draft);
  });
  await check('05-language-survives-restart', async () => {
    await adb('shell', 'am', 'force-stop', applicationId);
    await adb('shell', 'am', 'start', '-n', activity);
    await waitText(copy.ru.settings);
    await tap(copy.ru.settings, { last: true });
    await waitText('Язык，Русский');
  });
  report.errors = await appErrorLogs();
  assert.doesNotMatch(report.errors, /FATAL EXCEPTION|ReactNativeJS.*(?:TypeError|ReferenceError|Error:)/);
} finally {
  report.finishedAt = new Date().toISOString();
  await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
}
