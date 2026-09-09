import { website } from './validation.js';
import { allSitesAllowed, assertWebsitePermission, siteAccessMode } from './site-access.js';

const pending = new Map();
const REQUEST_TIMEOUT_MS = 120000;
let paused = false;
let mutation = Promise.resolve();

function change(operation) {
  const next = mutation.catch(() => {}).then(operation);
  mutation = next;
  return next;
}

export async function initializePermissions() {
  const state = await chrome.storage.local.get('paused');
  paused = state.paused === true;
}

export function assertRunning(signal) {
  if (paused) throw new Error('浏览器控制已暂停，请在浏览器助手中继续。');
  if (signal?.aborted) throw new Error('浏览器操作已取消。');
}

export async function setPaused(value) {
  paused = value === true;
  await chrome.storage.local.set({ paused });
  if (paused) {
    for (const item of pending.values()) item.finish(false);
  }
  await refreshBadge();
}

export async function status() {
  const { siteGrants = [] } = await chrome.storage.local.get('siteGrants');
  const { sessionGrants = [] } = await chrome.storage.session.get('sessionGrants');
  const allowedOrigins = [...new Set([...siteGrants, ...sessionGrants].map((grant) => grant.origin))];
  return { paused, allowedOrigins, allSitesAllowed: await allSitesAllowed(),
    pending: [...pending.values()].map(({ id, origin }) => ({ id, origin })) };
}

export function setSiteAccessMode(allowAll) {
  return change(async () => {
    await chrome.storage.local.set({ siteAccessMode: allowAll ? 'all' : 'ask' });
    for (const item of pending.values()) item.finish(false);
  });
}

export async function authorize(value, clientId, signal) {
  assertRunning(signal);
  const origin = website(value).origin;
  await assertWebsitePermission(origin);
  assertRunning(signal);
  if (await siteAccessMode() === 'all') { assertRunning(signal); return; }
  const { siteGrants = [] } = await chrome.storage.local.get('siteGrants');
  const { sessionGrants = [] } = await chrome.storage.session.get('sessionGrants');
  if (![...siteGrants, ...sessionGrants].some((grant) => grant.clientId === clientId && grant.origin === origin)) {
    await requestAccess({ origin, clientId, signal });
  }
  assertRunning(signal);
}

function requestAccess({ origin, clientId, signal }) {
  assertRunning(signal);
  const id = crypto.randomUUID();
  let finish;
  const promise = new Promise((resolve, reject) => {
    const timer = setTimeout(() => finish(false), REQUEST_TIMEOUT_MS);
    const abort = () => finish(false);
    finish = (allowed) => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      const windowId = pending.get(id)?.windowId;
      pending.delete(id);
      // A cancelled or expired request must not leave a permission prompt that can no longer be answered.
      if (windowId !== undefined) void chrome.windows.remove(windowId).catch(() => {});
      void refreshBadge();
      if (allowed) resolve();
      else reject(new Error('未获得网站访问许可。请在 Chrome 中确认后重试。'));
    };
    signal?.addEventListener('abort', abort, { once: true });
  });
  pending.set(id, { id, origin, clientId, finish, promise });
  void refreshBadge();
  void chrome.windows.create({ url: chrome.runtime.getURL(`approval.html?id=${id}`),
    type: 'popup', width: 400, height: 520, focused: true }).then((window) => {
      const item = pending.get(id);
      if (item) item.windowId = window.id;
      else void chrome.windows.remove(window.id).catch(() => {});
    }).catch(() => finish(false));
  return promise;
}

export function accessRequest(id) {
  const item = pending.get(id);
  return item ? { id, origin: item.origin } : null;
}

export function windowClosed(windowId) {
  for (const item of pending.values()) {
    if (item.windowId === windowId) { item.windowId = undefined; item.finish(false); }
  }
}

export function decideAccess(id, decision) {
  return change(() => saveDecision(id, decision));
}

async function saveDecision(id, decision) {
  const item = pending.get(id);
  if (!item) throw new Error('这次请求已结束，请重新操作。');
  if (decision === 'always') {
    const { siteGrants = [] } = await chrome.storage.local.get('siteGrants');
    await chrome.storage.local.set({ siteGrants: addGrant(siteGrants, item) });
  } else if (decision === 'session') {
    const { sessionGrants = [] } = await chrome.storage.session.get('sessionGrants');
    await chrome.storage.session.set({ sessionGrants: addGrant(sessionGrants, item) });
  }
  item.finish(decision === 'always' || decision === 'session');
}

function addGrant(grants, { clientId, origin }) {
  return [...grants.filter((grant) => grant.clientId !== clientId || grant.origin !== origin), { clientId, origin }];
}

export function revoke(value) {
  const origin = website(value).origin;
  for (const item of pending.values()) {
    if (item.origin === origin) item.finish(false);
  }
  return change(async () => {
    const { siteGrants = [] } = await chrome.storage.local.get('siteGrants');
    const { sessionGrants = [] } = await chrome.storage.session.get('sessionGrants');
    await chrome.storage.local.set({ siteGrants: siteGrants.filter((grant) => grant.origin !== origin) });
    await chrome.storage.session.set({ sessionGrants: sessionGrants.filter((grant) => grant.origin !== origin) });
  });
}

async function refreshBadge() {
  await chrome.action.setBadgeText({ text: pending.size ? '!' : paused ? 'Ⅱ' : '' });
  await chrome.action.setBadgeBackgroundColor({ color: pending.size ? '#c26b17' : '#5d726e' });
}
