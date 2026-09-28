import assert from 'node:assert/strict';
import { adb, serverState, waitFor, waitText, tap, screenshot, nodes } from './android-chat-driver.mjs';

async function stageBounds() {
  return (await nodes()).find(node => node['content-desc'] === '远程桌面触控区域')?.rect;
}

async function inputNodes() {
  try { return await nodes(); }
  catch (error) {
    // Opening the WebView briefly replaces Android's accessibility root.
    if (String(error).includes('A fresh hierarchy is required')) return [];
    throw error;
  }
}

async function verifyChords() {
  await tap('快捷键'); await waitText('Ctrl+C 复制'); await tap('Ctrl+C 复制');
  await waitFor(async () => (await serverState()).desktop.inputs.at(-1)?.code === 'ControlLeft', 'shortcut input');
  assert.deepEqual((await serverState()).desktop.inputs.slice(-4), [
    { kind: 'keyboard', code: 'ControlLeft', down: true }, { kind: 'keyboard', code: 'KeyC', down: true },
    { kind: 'keyboard', code: 'KeyC', down: false }, { kind: 'keyboard', code: 'ControlLeft', down: false },
  ]);
  await screenshot('05-shortcuts');
  const before = (await serverState()).desktop.inputs.length;
  await tap('电脑键盘'); await tap('组合键模式'); await tap('Ctrl'); await tap('Shift'); await tap('Z');
  await waitFor(async () => (await serverState()).desktop.inputs.length === before + 6, 'combination input');
  assert.deepEqual((await serverState()).desktop.inputs.slice(-6), [
    { kind: 'keyboard', code: 'ControlLeft', down: true }, { kind: 'keyboard', code: 'ShiftLeft', down: true },
    { kind: 'keyboard', code: 'KeyZ', down: true }, { kind: 'keyboard', code: 'KeyZ', down: false },
    { kind: 'keyboard', code: 'ShiftLeft', down: false }, { kind: 'keyboard', code: 'ControlLeft', down: false },
  ]);
  await screenshot('05-computer-keyboard');
}

export async function verifyDesktopInput() {
  const initialStage = await stageBounds();
  assert(initialStage[2] - initialStage[0] > initialStage[3] - initialStage[1], 'desktop defaults to landscape');
  await tap('键盘');
  await waitFor(async () => {
    const current = await inputNodes();
    const editor = current.find(node => node.class === 'android.widget.EditText');
    const stage = current.find(node => node['content-desc'] === '远程桌面触控区域');
    const keyboard = await adb('shell', 'dumpsys', 'input_method');
    return editor && stage && stage.rect[3] < initialStage[3]
      && editor.rect[1] >= stage.rect[3] && /mInputShown=true/.test(keyboard);
  }, 'keyboard input visible above the landscape IME');
  await screenshot('05-system-keyboard');
  console.log('PASS system keyboard opens automatically in landscape');
  await adb('shell', 'input', 'text', 'native-desktop');
  await waitFor(async () => (await serverState()).desktop.inputs.filter(value => value.kind === 'text')
    .map(value => value.text).join('').includes('native-desktop'), 'immediate text input');
  await verifyChords();
  console.log('PASS immediate input, shortcuts and key combinations');
  await tap('收起键盘');
  await waitFor(async () => {
    const stage = await stageBounds();
    return stage && stage[2] - stage[0] > stage[3] - stage[1];
  }, 'input controls leave the desktop in landscape');
}

export async function verifyDesktopOrientation() {
  await tap('旋转', { scroll: true });
  await waitFor(async () => {
    const [left, top, right, bottom] = (await nodes())[0].rect;
    return right - left < bottom - top;
  }, 'manual portrait rotation');
  await tap('键盘');
  await waitFor(async () => /mInputShown=true/.test(await adb('shell', 'dumpsys', 'input_method')),
    'portrait keyboard opens');
  const [left, top, right, bottom] = (await inputNodes())[0].rect;
  assert(right - left < bottom - top, 'opening input preserves the chosen portrait orientation');
  await tap('收起键盘'); await tap('关闭', { scroll: true });
  await waitText('打开工具');
  const root = (await nodes())[0].rect;
  assert(root[2] - root[0] < root[3] - root[1], 'closing the desktop restores portrait');
  await tap('打开工具'); await tap('远程桌面');
  await waitFor(async () => {
    const stage = await stageBounds();
    return stage && stage[2] - stage[0] > stage[3] - stage[1];
  }, 'reopening always defaults to landscape');
  await screenshot('07-reopened-landscape');
  await tap('关闭', { scroll: true });
  console.log('PASS manual rotation, input orientation, close and reopen');
}
