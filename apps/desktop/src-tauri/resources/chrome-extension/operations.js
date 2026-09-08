import { authorize, assertRunning, status } from './permissions.js';
import { validate, website } from './validation.js';
import { withTab } from './driver.js';
import { snapshot, frames, invalidate } from './snapshot.js';
import * as actions from './actions.js';

const MAX_SCREENSHOT_CHARACTERS = 12 * 1024 * 1024;

export async function execute(context, request) {
  const { operation, args } = validate(request);
  if (operation === 'status') return status();
  assertRunning(context.signal);
  if (operation === 'tabs') return listTabs();
  if (operation === 'open') return open(context, args);
  if (['navigate', 'close', 'focus'].includes(operation)) return tabAction(context, operation, args);
  return withTab(context, args, (driver) => pageAction(driver, operation, args));
}

async function listTabs() {
  const tabs = await chrome.tabs.query({});
  return { tabs: tabs.map(({ id, windowId, url, title, active }) => ({ tabId: id, windowId, url, title, active })) };
}

async function open(context, args) {
  const url = website(args.url).href;
  await authorize(url, context.clientId, context.signal);
  const tab = await chrome.tabs.create({ url, active: args.background === false });
  return { tabId: tab.id, url };
}

async function tabAction(context, operation, args) {
  const tab = await chrome.tabs.get(args.tabId);
  await authorize(tab.url, context.clientId, context.signal);
  if (operation === 'close') {
    await chrome.tabs.remove(tab.id);
    invalidate(tab.id);
    return { closed: true };
  }
  if (operation === 'focus') {
    await chrome.tabs.update(tab.id, { active: true });
    await chrome.windows.update(tab.windowId, { focused: true });
    return { focused: true };
  }
  const url = website(args.url).href;
  await authorize(url, context.clientId, context.signal);
  invalidate(tab.id);
  await chrome.tabs.update(tab.id, { url });
  return { tabId: tab.id, url };
}

async function pageAction(driver, operation, args) {
  if (operation === 'snapshot') return snapshot(driver, args);
  if (operation === 'frames') return { frames: await frames(driver) };
  if (operation === 'fill' || operation === 'type') return actions.fill(driver, args, operation === 'fill');
  if (['click', 'key', 'scroll', 'select', 'check', 'drag'].includes(operation)) return actions[operation](driver, args);
  if (operation === 'screenshot') {
    const result = await driver.send('Page.captureScreenshot', { format: 'jpeg', quality: 80,
      captureBeyondViewport: false, fromSurface: true });
    if (result.data.length > MAX_SCREENSHOT_CHARACTERS) throw new Error('截图过大，请缩小浏览器窗口后重试。');
    return { tabId: driver.tab.id, image: { mimeType: 'image/jpeg', data: result.data } };
  }
  if (operation === 'wait') return waitForText(driver, args);
  if (operation === 'reload') {
    invalidate(driver.tab.id);
    await driver.send('Page.reload');
    return { reloaded: true };
  }
  return history(driver, operation);
}

async function history(driver, operation) {
  const { entries, currentIndex } = await driver.send('Page.getNavigationHistory');
  const entry = entries[currentIndex + (operation === 'back' ? -1 : 1)];
  if (!entry) throw new Error('没有可切换的历史页面。');
  await authorize(entry.url, driver.context.clientId, driver.context.signal);
  invalidate(driver.tab.id);
  await driver.send('Page.navigateToHistoryEntry', { entryId: entry.id });
  return { url: entry.url };
}

async function waitForText(driver, args) {
  const deadline = Date.now() + (args.timeoutMs ?? 10000);
  while (Date.now() < deadline) {
    await driver.guard();
    const result = await snapshot(driver);
    if (result.text.includes(args.text)) return result;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error('等待时间已到，页面中还没有出现指定内容。');
}
