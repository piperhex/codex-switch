import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { adb, output, prepare, serverState, waitFor, waitText, tap, input, screenshot, hasText }
  from './android-chat-driver.mjs';

const expectedSkill = { name: 'review', path: 'F:/skills/review/SKILL.md' };
const report = { startedAt: new Date().toISOString(), cases: [] };
const operations = async (name) => (await serverState()).operations.filter((entry) => entry.operation === name);
const ready = () => waitFor(async () => await hasText('已直连') || await hasText('通过服务器连接'), 'connected');
async function setSkills(input) {
  const response = await fetch('http://127.0.0.1:1490/test/skills', { method: 'POST',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
  assert.equal(response.ok, true);
}
async function check(name, action) {
  console.log(`RUN ${name}`);
  await action();
  await screenshot(name);
  report.cases.push(name);
  console.log(`PASS ${name}`);
}

try {
  report.device = await prepare();
  await waitText('云端服务器地址');
  await input(0, 'http://127.0.0.1:1490');
  await input(1, 'mobile-test@example.test');
  await input(2, 'local-test');
  await adb('shell', 'input', 'keyevent', 'KEYCODE_BACK');
  await tap('登录并查看');
  await waitText('账户管理');
  await tap('聊天', { last: true });
  await ready();

  await check('skills-01-prefetch-and-cached-menu', async () => {
    await waitFor(async () => (await operations('skills')).length > 0, 'prefetch before opening menu');
    await setSkills({ revision: 2, delay: 15_000 });
    await tap('命令和技能');
    await waitText('使用技能 代码检查');
    assert.equal(await hasText('正在加载技能'), false);
    await tap('使用技能 代码检查');
    await waitText('$review');
    await tap('发送消息');
    await waitFor(async () => (await operations('send')).length > 0, 'skill send');
    assert.deepEqual((await operations('send')).at(-1).skills, [expectedSkill]);
  });

  await check('skills-02-refresh-while-open', async () => {
    await tap('命令和技能');
    await waitText('使用技能 代码检查（已更新）');
    assert.equal(await hasText('正在加载技能'), false);
    await tap('关闭命令和技能');
    await setSkills({ delay: 0 });
  });

  await check('skills-03-slash-and-steer', async () => {
    await input('聊天消息', 'slow task');
    await tap('发送消息');
    await waitText('停止回复');
    for (let count = 1; count <= 2; count++) {
      await input('聊天消息', '/rev');
      await waitText('使用技能 代码检查（已更新）');
      await tap('使用技能 代码检查（已更新）');
      await tap('补充消息');
      await waitFor(async () => (await operations('steer')).length === count, 'repeated skill steer');
      assert.deepEqual((await operations('steer')).at(-1).skills, [expectedSkill]);
    }
    await tap('停止回复');
  });

  await check('skills-04-project-and-compact', async () => {
    await adb('shell', 'input', 'keyevent', 'KEYCODE_BACK');
    await tap('打开聊天列表');
    await tap('移动端聊天体验');
    await waitFor(async () => (await operations('skills')).some((entry) => entry.cwd === 'F:/projects/demo'),
      'project prefetch');
    await input('聊天消息', '/compact');
    await waitText('压缩上下文');
    await tap('压缩上下文');
    await waitFor(async () => (await operations('compact')).length > 0, 'compact command');
    assert.equal((await operations('compact')).at(-1).threadId, 'demo-chat');
    assert.equal((await operations('send')).some((entry) => entry.text === '/compact'), false);
    await waitFor(async () => !await hasText('正在压缩上下文'), 'compact completed');
  });

  await check('skills-05-persistent-cache-after-restart', async () => {
    await setSkills({ delay: 20_000 });
    await adb('shell', 'am', 'force-stop', 'com.codexswitch.mobile');
    await adb('shell', 'am', 'start', '-n', 'com.codexswitch.mobile/.MainActivity');
    await waitText('账户管理');
    await tap('聊天', { last: true });
    await ready();
    const started = Date.now();
    await tap('命令和技能');
    await waitText('使用技能 代码检查（已更新）');
    assert.ok(Date.now() - started < 15_000, 'cached menu must appear before the delayed PC response');
    assert.equal(await hasText('正在加载技能'), false);
  });
  report.passed = true;
} catch (error) {
  report.error = String(error);
  await screenshot('skills-failed');
  throw error;
} finally {
  await writeFile(path.join(output, 'skills-report.json'), JSON.stringify(report, null, 2));
}
