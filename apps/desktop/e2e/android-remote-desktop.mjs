import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { adb, apiUrl, output, prepare, serverState, waitFor, waitText, tap, input, screenshot, hasText, nodes }
  from './android-chat-driver.mjs';

import { verifyDesktopInput, verifyDesktopOrientation } from './android-desktop-input.mjs';

const report = { started: new Date().toISOString(), checks: [] };
async function check(name, run) {
  await run(); report.checks.push(name); await screenshot(name); console.log(`PASS ${name}`);
}
async function loginInput(target, value) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try { await input(target, value); return; }
    catch (error) {
      // The first-run update check can finish between reading the fields and tapping them.
      if (!(await hasText('忽略本版本'))) throw error;
      await tap('忽略本版本');
      await waitFor(async () => (await nodes()).filter(node => node.class === 'android.widget.EditText').length >= 3,
        'login fields after dismissing update');
    }
  }
  throw new Error('Login fields remained unavailable');
}
try {
  if (process.env.ANDROID_CHAT_DISPOSABLE !== '1') throw new Error('A disposable emulator is required.');
  await adb('shell', 'am', 'force-stop', 'com.codexswitch.mobile');
  await fetch(`${apiUrl}/test/reset`, { method: 'POST' });
  report.device = await prepare();
  await waitFor(async () => {
    try { return await hasText('云端服务器地址'); }
    catch (error) {
      // A cold install briefly exposes only the splash window, with no accessibility root yet.
      if (!String(error).includes('A fresh hierarchy is required')) throw error;
      return false;
    }
  }, 'login screen after cold start');
  await waitFor(async () => {
    if (await hasText('忽略本版本')) await tap('忽略本版本');
    return (await nodes()).filter(node => node.class === 'android.widget.EditText').length >= 3;
  }, 'login fields after update prompt');
  await loginInput(0, apiUrl);
  await loginInput(1, 'mobile-test@example.test'); await loginInput(2, 'local-test');
  await adb('shell', 'input', 'keyevent', 'KEYCODE_BACK');
  await tap('我已阅读并同意用户协议');
  await tap('登录并查看'); await waitText('聊天消息');
  await waitFor(async () => (await hasText('Relay')) || (await hasText('P2P')), 'chat connected');
  await tap('打开工具'); await tap('远程桌面');
  await check('01-native-video', async () => {
    await waitText('fps');
    const logs = await adb('logcat', '-d', '-s', 'WebRTCModule:V', 'WebRTCView:V', 'org.webrtc.Logging:V');
    await writeFile(path.join(output, 'native-webrtc.log'), logs);
    assert((await serverState()).desktop.frames > 5);
  });
  await check('02-mouse-buttons', async () => {
    if (await hasText('展开鼠标面板')) await tap('展开鼠标面板');
    await waitText('鼠标左键');
    await tap('鼠标左键'); await tap('鼠标右键'); await tap('展开滚动滑块');
    const pad = (await nodes()).find(node => node['content-desc'] === '十字滚动滑块');
    const [left, top, right, bottom] = pad.rect;
    const x = String(Math.round((left + right) / 2));
    const y = String(Math.round(top + (bottom - top) * .8));
    await adb('shell', 'input', 'tap', x, y);
    await adb('shell', 'input', 'tap', x, String(Math.round((top + bottom) / 2)));
    await waitFor(async () => (await serverState()).desktop.inputs.some(value =>
      value.kind === 'wheel' && value.delta < 0), 'wheel input');
    const inputs = (await serverState()).desktop.inputs;
    assert(inputs.some(value => value.kind === 'button' && value.button === 'left' && value.down));
    assert(inputs.some(value => value.kind === 'button' && value.button === 'right' && !value.down));
    assert(inputs.some(value => value.kind === 'wheel' && value.delta < 0));
  });
  await check('02b-latched-drag', async () => {
    if (await hasText('展开鼠标面板')) await tap('展开鼠标面板');
    await waitText('鼠标左键');
    const left = (await nodes()).find(node => node['content-desc'] === '鼠标左键');
    const [x1, y1, x2, y2] = left.rect;
    const x = String(Math.round((x1 + x2) / 2)); const y = String(Math.round((y1 + y2) / 2));
    await adb('shell', 'input', 'swipe', x, y, x, y, '700');
    await waitText('拖拽中');
    const dragStart = (await serverState()).desktop.inputs.length;
    const pad = (await nodes()).find(node => node['content-desc'] === '滑动移动鼠标，轻点单击');
    const [px1, py1, px2, py2] = pad.rect;
    await adb('shell', 'input', 'swipe', String(px1 + 30), String((py1 + py2) / 2),
      String(px2 - 30), String((py1 + py2) / 2), '350');
    await waitFor(async () => {
      const moves = (await serverState()).desktop.inputs.slice(dragStart).filter(value => value.kind === 'move');
      return moves.length > 1 && moves.at(-1).x - moves[0].x > 0.1;
    }, 'continuous drag motion');
    assert(!(await serverState()).desktop.inputs.slice(dragStart).some(value => value.kind === 'button'));
    await tap('鼠标左键');
    await waitFor(async () => (await serverState()).desktop.inputs.at(-1).down === false, 'drag release');
  });
  await check('02c-input-mode-toggle', async () => {
    const modes = (await nodes()).filter(node => /切换为(鼠标|触屏)模式/.test(node['content-desc']));
    assert.equal(modes.length, 1, 'mouse and touch share one mode button');
    await tap('切换为触屏模式'); await waitText('切换为鼠标模式');
    assert(!(await hasText('鼠标左键')) && !(await hasText('展开鼠标面板')));
    await tap('切换为鼠标模式'); await waitText('鼠标左键'); await waitText('切换为触屏模式');
  });
  await check('03-landscape', async () => {
    await waitFor(async () => {
      const stage = (await nodes()).find(node => node['content-desc'] === '远程桌面触控区域');
      return stage && stage.rect[2] - stage.rect[0] > stage.rect[3] - stage.rect[1];
    }, 'landscape layout without pressing rotate');
  });
  await check('03a-pinch-and-stats', async () => {
    const before = (await serverState()).desktop.inputs.length;
    const result = await adb('shell', 'uiautomator', 'runtest', '/system/framework/android.test.base.jar',
      '/data/local/tmp/chat-hierarchy.jar', '-c', 'dev.codexswitch.testing.RemoteDesktopGestureTest');
    assert(result.includes('OK (2 tests)') && !result.includes('shortMsg='), result);
    const gestures = (await serverState()).desktop.inputs.slice(before);
    assert(gestures.length > 0 && gestures.every(value => value.kind === 'move'),
      'only the stability-check swipe moves the mouse, with no accidental clicks');
    await waitText('Mbps'); await waitText('丢包');
    await tap('关闭连接状态'); await waitFor(async () => !(await hasText('Mbps')), 'stats hidden');
    await tap('显示'); await tap('连接状态'); await tap('关闭显示设置'); await waitText('Mbps');
  });
  await check('03b-mouse-black-border', async () => {
    const stage = (await nodes()).find(node => node['content-desc'] === '远程桌面触控区域');
    assert(stage);
    const [left, top, right, bottom] = stage.rect;
    await adb('shell', 'input', 'swipe', String(left + 200), String(top + 200),
      String(right - 100), String(bottom - 50), '500');
    await waitFor(async () => {
      const move = (await serverState()).desktop.inputs.filter(value => value.kind === 'move').at(-1);
      return move?.x > 0.95 && move.y > 0.95;
    }, 'pointer reaches bottom-right');
    if (await hasText('展开鼠标面板')) await tap('展开鼠标面板');
    const controls = await nodes();
    for (const label of ['鼠标左键', '鼠标右键', '展开滚动滑块', '滑动移动鼠标，轻点单击']) {
      const control = controls.find(node => node['content-desc'] === label);
      assert(control, label);
      assert(control.rect[0] >= left && control.rect[1] >= top, label);
      assert(control.rect[2] <= right && control.rect[3] <= bottom, label);
    }
  });
  await check('04-display-settings', async () => {
    await tap('显示'); await waitText('自定义帧率'); await input('自定义帧率', '45');
    await adb('shell', 'input', 'keyevent', 'KEYCODE_BACK');
    await tap('应用帧率'); await tap('高清');
    await waitFor(async () => {
      const settings = (await serverState()).desktop.settings.at(-1);
      return settings.fps === 45 && settings.quality === 'clear';
    }, 'custom display settings');
    await screenshot('04-display-open');
    await tap('关闭显示设置');
  });
  await check('05-native-keyboard', verifyDesktopInput);
  await check('05b-orientation-lifecycle', async () => {
    await verifyDesktopOrientation();
    await tap('打开工具'); await tap('远程桌面'); await waitText('fps');
  });
  await check('06-background-cleanup', async () => {
    await adb('shell', 'input', 'keyevent', 'KEYCODE_HOME');
    await waitFor(async () => (await serverState()).desktop.closed > 0, 'capture cleanup');
    assert.equal((await serverState()).desktop.maxConcurrent, 1);
  });
  report.passed = true;
} catch (error) {
  report.error = String(error); await screenshot('failed'); throw error;
} finally {
  await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
}
