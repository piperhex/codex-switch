import assert from 'node:assert/strict';
import { adb, hasText, screenshot, send, serverState, tap, waitFor, waitText } from './android-chat-driver.mjs';

const ROTATE = '转到手机当前方向';
const orientation = async () => {
  const input = await adb('shell', 'dumpsys', 'window', 'displays');
  return Number(input.match(/mRotation=(\d)/)?.[1]);
};
const savedPictures = async () => {
  const result = await adb('shell', 'content', 'query', '--uri', 'content://media/external/images/media',
    '--projection', '_display_name:mime_type:_size:relative_path');
  return result.split('\n').filter((line) => line.includes('CodexSwitch-'));
};

async function rotateTo({ gravity, surface }) {
  await adb('emu', 'sensor', 'set', 'acceleration', gravity);
  await waitText(ROTATE);
  await tap(ROTATE);
  await waitFor(async () => await orientation() === surface, 'preview follows physical phone direction');
  await waitFor(async () => !(await hasText(ROTATE)), 'rotation suggestion disappears after applying');
}

async function pinch(label, direction) {
  const result = await adb('shell', 'uiautomator', 'runtest', '/system/framework/android.test.base.jar',
    '/data/local/tmp/chat-hierarchy.jar', '-c', 'dev.codexswitch.testing.ImageGestureTest',
    '-e', 'label', label, '-e', 'direction', direction);
  assert.ok(result.includes('OK (1 test)'), result);
  await screenshot(`image-preview-${label}-pinch-${direction}`);
}

export async function imagePreviewJourney() {
  await adb('emu', 'sensor', 'set', 'acceleration', '0:9.8:0');
  try {
    for (const [prompt, label] of [['local image preview', '本地图片'], ['remote image preview', '网络图片']]) {
      await send(prompt, { dismissKeyboard: false });
      await waitText(`放大查看：${label}`);
      await tap(`放大查看：${label}`);
      await waitText('保存到相册');
      await waitFor(async () => !(await hasText('正在加载原图…')), 'original loaded');
      for (const removed of ['关闭图片', '放大图片', '缩小图片', '旋转图片', '原图加载失败']) {
        assert.equal(await hasText(removed), false, removed);
      }
      assert.equal(await hasText(ROTATE), false);
      await screenshot(`image-preview-${label}-portrait`);
      await pinch(label, 'out');
      await pinch(label, 'in');
      const before = await savedPictures();
      await tap('保存到相册');
      await waitFor(async () => (await savedPictures()).length === before.length + 1, 'original in system album');
      const added = (await savedPictures()).filter((line) => !before.includes(line));
      assert.match(added[0], /mime_type=image\/png/);
      assert.match(added[0], /relative_path=Pictures\/Codex Switch\//);
      assert.ok(Number(added[0].match(/_size=(\d+)/)?.[1]) > 0);
      // Moving the phone offers rotation without rotating the preview automatically.
      await adb('emu', 'sensor', 'set', 'acceleration', '9.8:0:0');
      await waitText(ROTATE);
      assert.equal(await orientation(), 0);
      await screenshot(`image-preview-${label}-rotation-suggestion`);
      await tap(ROTATE);
      await waitFor(async () => await orientation() === 1, 'landscape preview');
      await waitFor(async () => !(await hasText(ROTATE)), 'rotation applied');
      await screenshot(`image-preview-${label}-landscape`);
      assert.equal(await hasText('保存到相册'), true, 'preview remains open after rotation');
      await rotateTo({ gravity: '-9.8:0:0', surface: 3 });
      await rotateTo({ gravity: '0:9.8:0', surface: 0 });
      if (label === '本地图片') await tap(label, { last: true });
      else await adb('shell', 'input', 'keyevent', 'KEYCODE_BACK');
      await waitText('聊天消息');
      assert.equal(await hasText('保存到相册'), false);
      assert.equal(await orientation(), 0);
    }
    const operations = (await serverState()).operations;
    assert.ok(operations.some((entry) => entry.operation === 'imagePreview'));
    assert.ok(operations.filter((entry) => entry.operation === 'imageChunk').length > 1);
    await send('message after images', { dismissKeyboard: false });
  } finally {
    await adb('emu', 'sensor', 'set', 'acceleration', '0:9.8:0');
  }
}
