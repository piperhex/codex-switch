import { pageCall } from './driver.js';
import { reference } from './snapshot.js';

async function point(driver, ref) {
  await pageCall(driver, ref, `function() {
    if (!this.isConnected) throw new Error('stale');
    this.scrollIntoView({behavior:'instant', block:'center', inline:'center'});
    const box = this.getBoundingClientRect();
    const hit = this.ownerDocument.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
    if (!hit || (hit !== this && !this.contains(hit))) throw new Error('covered');
  }`);
  const { quads } = await driver.send('DOM.getContentQuads', { backendNodeId: ref.nodeId }, ref.frameId);
  const quad = quads.find((quad) => quad.length === 8);
  if (!quad) throw new Error('这个元素当前不可见，请重新读取页面。');
  return { x: (quad[0] + quad[2] + quad[4] + quad[6]) / 4,
    y: (quad[1] + quad[3] + quad[5] + quad[7]) / 4, frameId: ref.frameId };
}

async function mouse(driver, position, options = {}) {
  const { frameId, x, y } = position;
  await driver.guard();
  for (let clickCount = 1; clickCount <= (options.doubleClick ? 2 : 1); clickCount += 1) {
    await driver.send('Input.dispatchMouseEvent', { x, y, button: options.button ?? 'left',
      clickCount, type: 'mousePressed' }, frameId);
    await driver.send('Input.dispatchMouseEvent', { x, y, button: options.button ?? 'left',
      clickCount, type: 'mouseReleased' }, frameId);
  }
}

export async function click(driver, args) {
  const position = args.ref ? await point(driver, await reference(driver, args.ref)) : { x: args.x, y: args.y };
  await mouse(driver, position, args);
  return { clicked: true };
}

export async function fill(driver, args, replace) {
  const ref = await reference(driver, args.ref);
  await pageCall(driver, ref, `function(replace) {
    if (this.disabled || this.readOnly) throw new Error('disabled');
    if (!this.isContentEditable && !['INPUT','TEXTAREA'].includes(this.tagName)) throw new Error('not editable');
    this.focus();
    if (!replace) return;
    if (this.isContentEditable) {
      const range = document.createRange(); range.selectNodeContents(this);
      const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
    } else this.select();
  }`, [replace]);
  await driver.guard();
  if (replace && args.text === '') {
    const event = {key:'Backspace', code:'Backspace', windowsVirtualKeyCode:8};
    await driver.send('Input.dispatchKeyEvent', {...event, type:'rawKeyDown'}, ref.frameId);
    await driver.send('Input.dispatchKeyEvent', {...event, type:'keyUp'}, ref.frameId);
  } else await driver.send('Input.insertText', { text: args.text }, ref.frameId);
  return { entered: true };
}

const KEY_CODES = {
  Enter: ['Enter', 13], Tab: ['Tab', 9], Escape: ['Escape', 27], Backspace: ['Backspace', 8],
  Delete: ['Delete', 46], ArrowLeft: ['ArrowLeft', 37], ArrowRight: ['ArrowRight', 39],
  ArrowUp: ['ArrowUp', 38], ArrowDown: ['ArrowDown', 40], Home: ['Home', 36], End: ['End', 35],
  PageUp: ['PageUp', 33], PageDown: ['PageDown', 34], Space: ['Space', 32],
};
const MODIFIERS = { Alt: 1, Control: 2, Meta: 4, Shift: 8 };

export async function key(driver, args) {
  const parts = args.key.split('+');
  const value = parts.pop();
  if (parts.some((part) => !MODIFIERS[part])) throw new Error('不支持这个快捷键。');
  const modifiers = parts.reduce((flags, part) => flags | MODIFIERS[part], 0);
  const known = KEY_CODES[value];
  if (!known && !/^[a-zA-Z0-9]$/.test(value)) throw new Error('不支持这个按键。');
  const code = known?.[0] ?? (/\d/.test(value) ? `Digit${value}` : `Key${value.toUpperCase()}`);
  const virtualKey = known?.[1] ?? value.toUpperCase().charCodeAt(0);
  const event = { key: value === 'Space' ? ' ' : value, code, modifiers, windowsVirtualKeyCode: virtualKey };
  const printable = value === 'Enter' ? '\r' : value === 'Space' ? ' ' : known ? undefined : value;
  const text = (modifiers & 7) === 0 ? (modifiers & MODIFIERS.Shift ? printable?.toUpperCase() : printable) : undefined;
  await driver.guard();
  await driver.send('Input.dispatchKeyEvent', { ...event, type: text ? 'keyDown' : 'rawKeyDown', ...(text ? { text } : {}) });
  await driver.send('Input.dispatchKeyEvent', { ...event, type: 'keyUp' });
  return { pressed: args.key };
}

export async function scroll(driver, args) {
  const metrics = await driver.send('Page.getLayoutMetrics');
  const viewport = metrics.cssVisualViewport;
  await driver.send('Input.dispatchMouseEvent', { type: 'mouseWheel',
    x: args.x ?? viewport.clientWidth / 2, y: args.y ?? viewport.clientHeight / 2,
    deltaY: args.deltaY, deltaX: args.deltaX ?? 0 });
  return { scrolled: true };
}

export async function select(driver, args) {
  const ref = await reference(driver, args.ref);
  return pageCall(driver, ref, `function(value) {
    if (this.tagName !== 'SELECT' || this.disabled) throw new Error('not a select');
    const option = [...this.options].find(option => option.value === value && !option.disabled);
    if (!option) throw new Error('option not found');
    this.value = value; this.dispatchEvent(new Event('input', {bubbles:true}));
    this.dispatchEvent(new Event('change', {bubbles:true})); return {selected:value};
  }`, [args.value]);
}

export async function check(driver, args) {
  const ref = await reference(driver, args.ref);
  const checked = await pageCall(driver, ref, `function() {
    if (!['checkbox','radio'].includes(this.type) || this.disabled) throw new Error('not a checkbox');
    return this.checked;
  }`);
  if (checked !== args.checked) await mouse(driver, await point(driver, ref));
  return { checked: await pageCall(driver, ref, 'function() { return this.checked; }') };
}

export async function drag(driver, args) {
  const from = await point(driver, await reference(driver, args.fromRef));
  const to = await point(driver, await reference(driver, args.toRef));
  if (from.frameId !== to.frameId) throw new Error('请在同一页面框架内拖动。');
  await driver.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: from.x, y: from.y }, from.frameId);
  await driver.send('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1,
    x: from.x, y: from.y }, from.frameId);
  for (let step = 1; step <= 10; step += 1) {
    await driver.send('Input.dispatchMouseEvent', { type: 'mouseMoved', button: 'left', buttons: 1,
      x: from.x + (to.x - from.x) * step / 10, y: from.y + (to.y - from.y) * step / 10 }, from.frameId);
  }
  await driver.send('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1,
    x: to.x, y: to.y }, from.frameId);
  return { dragged: true };
}
