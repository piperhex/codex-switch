import * as permissions from './permissions.js';
import { execute } from './operations.js';
import { invalidate } from './snapshot.js';
import { stopDebugging } from './driver.js';

const HOST = 'dev.codex_switch.chrome';
const running = new Map();
let port;
let connectionError = '';
const initialized = permissions.initializePermissions();

async function connect() {
  await initialized;
  if (port) return;
  const next = chrome.runtime.connectNative(HOST);
  port = next;
  connectionError = '';
  next.onMessage.addListener((message) => { void handleRequest(next, message); });
  next.onDisconnect.addListener(() => {
    const reason = chrome.runtime.lastError?.message;
    if (port !== next) return;
    port = undefined;
    connectionError = reason ? '请先在 Codex Switch 中安装浏览器插件，再点击重新连接。' : '连接已断开，请重新连接。';
    for (const controller of running.values()) controller.abort();
    void stopDebugging();
    chrome.alarms.create('reconnect', { delayInMinutes: 0.5 });
  });
  const { profileName = 'Chrome' } = await chrome.storage.local.get('profileName');
  if (port === next) {
    try { next.postMessage({ type: 'ready', name: profileName }); }
    catch { connectionError = '连接已断开，请重新连接。'; }
  }
}

async function handleRequest(source, message) {
  if (message.type === 'cancel') { running.get(message.id)?.abort(); return; }
  if (typeof message.id !== 'string' || !/^[a-f0-9]{64}$/.test(message.clientId) || running.has(message.id)) return;
  const controller = new AbortController();
  running.set(message.id, controller);
  let reply;
  try {
    const result = await execute({ clientId: message.clientId, signal: controller.signal }, message.request);
    reply = { result, error: null };
  } catch (error) {
    reply = { result: null, error: error instanceof Error ? error.message : '浏览器操作未完成，请重试。' };
  } finally {
    running.delete(message.id);
  }
  // A cancelled Chrome connection has no recipient; do not reconnect and replay a completed action.
  if (port === source) {
    try { source.postMessage({ type: 'reply', id: message.id, ...reply }); }
    catch { connectionError = '连接已断开，请重新连接。'; }
  }
}

async function localMessage(message) {
  await initialized;
  switch (message.operation) {
    case 'status': return { connected: Boolean(port), connectionError, ...(await permissions.status()) };
    case 'connect': await connect(); return {};
    case 'pause':
      await permissions.setPaused(message.paused);
      if (message.paused) {
        for (const controller of running.values()) controller.abort();
        await stopDebugging();
      }
      return {};
    case 'revoke':
      // Stop all in-flight actions before removing a site's grant, including queued actions.
      for (const controller of running.values()) controller.abort();
      await permissions.revoke(message.origin);
      await stopDebugging();
      return {};
    case 'siteAccess':
      if (typeof message.allowAll !== 'boolean') throw new Error('网站访问设置无效。');
      for (const controller of running.values()) controller.abort();
      await permissions.setSiteAccessMode(message.allowAll);
      await stopDebugging();
      return {};
    case 'request': return permissions.accessRequest(message.id);
    case 'decide': await permissions.decideAccess(message.id, message.decision); return {};
    case 'profileName':
      if (typeof message.name !== 'string' || message.name.length > 60) throw new Error('名称过长。');
      await chrome.storage.local.set({ profileName: message.name.trim() || 'Chrome' });
      port?.postMessage({ type: 'ready', name: message.name.trim() || 'Chrome' });
      return {};
    default: throw new Error('请求无效。');
  }
}

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  // Page scripts and content scripts must never grant themselves website permission.
  const allowedPages = ['popup.html', 'approval.html'].map((page) => chrome.runtime.getURL(page));
  if (sender.id !== chrome.runtime.id || !allowedPages.some((page) => sender.url?.split('?')[0] === page)) return false;
  localMessage(message).then((result) => respond({ result })).catch((error) => respond({ error: error.message }));
  return true;
});
chrome.tabs.onUpdated.addListener((tabId, change) => { if (change.status === 'loading' || change.url) invalidate(tabId); });
chrome.tabs.onRemoved.addListener(invalidate);
chrome.windows.onRemoved.addListener(permissions.windowClosed);
chrome.permissions.onRemoved.addListener(({ origins }) => {
  if (!origins?.length) return;
  for (const controller of running.values()) controller.abort();
  void stopDebugging();
});
chrome.runtime.onInstalled.addListener(() => { void connect(); });
chrome.runtime.onStartup.addListener(() => { void connect(); });
chrome.alarms.onAlarm.addListener((alarm) => { if (alarm.name === 'reconnect') void connect(); });
void connect();
