import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { adb, apiUrl, output, prepare, nodes, tap, input, waitText, waitFor, hasText, screenshot, serverState }
  from './android-chat-driver.mjs';

const report = { startedAt: new Date().toISOString(), passed: false, cases: [] };
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function block(blocked) {
  const response = await fetch(`${apiUrl}/test/connection-block`, { method: 'POST',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ blocked }) });
  assert.ok(response.ok);
}
async function retrySeconds() {
  const label = (await nodes()).find((node) => /立即连接（\d+秒）/.test(node.text));
  return label ? Number(label.text.match(/（(\d+)秒）/)[1]) : null;
}
async function connected() {
  await waitFor(async () => await hasText('P2P') || await hasText('Relay'), 'connected');
  await waitFor(async () => !(await hasText('立即连接')) && await hasText('发送消息'), 'ready without reconnect action');
}

try {
  report.device = await prepare();
  await waitText('云端服务器地址');
  await input(0, apiUrl);
  await input(1, 'mobile-test@example.test');
  await input(2, 'local-test');
  await adb('shell', 'input', 'keyevent', 'KEYCODE_BACK');
  await tap('登录并查看');
  await waitText('同意并登录');
  await tap('同意并登录');
  await connected();
  await block(true);
  await waitFor(async () => (await retrySeconds()) >= 10, 'long enough automatic retry countdown');
  const before = await retrySeconds();
  await screenshot('reconnect-countdown');
  const dots = new Set();
  for (let sample = 0; sample < 5; sample++) {
    for (const node of await nodes()) if (/^\.{1,3}$/.test(node.text)) dots.add(node.text);
    await pause(220);
  }
  const after = await retrySeconds();
  assert.ok(after !== null && after < before, 'countdown follows elapsed time');
  assert.ok(dots.size > 1, 'ellipsis animates');
  report.cases.push('countdown-and-animated-ellipsis');
  const attempts = (await serverState()).mobileConnections;
  await block(false);
  await tap('立即连接');
  await waitFor(async () => (await serverState()).mobileConnections === attempts + 1, 'immediate retry');
  await connected();
  await screenshot('reconnect-manual-success');
  await pause((before + 1) * 1000);
  assert.equal((await serverState()).mobileConnections, attempts + 1, 'manual retry cancels the old automatic timer');
  report.cases.push('manual-connect-and-no-duplicate-attempt');
  await block(true);
  await waitFor(async () => (await retrySeconds()) >= 5, 'automatic retry countdown');
  const automatic = (await serverState()).mobileConnections;
  await block(false);
  await connected();
  assert.equal((await serverState()).mobileConnections, automatic + 1, 'automatic retry still runs');
  report.cases.push('automatic-reconnection');
  await screenshot('reconnect-auto-success');
  report.passed = true;
} catch (error) {
  report.error = String(error);
  await screenshot('reconnect-failed');
  throw error;
} finally {
  await block(false);
  await writeFile(path.join(output, 'reconnect-report.json'), JSON.stringify(report, null, 2));
}
