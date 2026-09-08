const error = document.querySelector('#error');
let paused = false;

async function send(message) {
  const reply = await chrome.runtime.sendMessage(message);
  if (reply.error) throw new Error(reply.error);
  return reply.result;
}

function rows(container, items, label, action, handler) {
  container.replaceChildren();
  if (!items.length) { container.textContent = '暂无'; return; }
  for (const item of items) {
    const row = document.createElement('div'); row.className = 'row';
    const text = document.createElement('span'); text.textContent = label(item);
    const button = document.createElement('button'); button.textContent = action; button.className = 'secondary';
    button.addEventListener('click', () => perform(() => handler(item)));
    row.append(text, button); container.append(row);
  }
}

async function refresh() {
  const state = await send({ operation: 'status' });
  paused = state.paused;
  document.querySelector('#status').textContent = state.connected
    ? paused ? '已连接 · 控制已暂停' : '已连接 · 等待你的任务' : '尚未连接 Codex Switch';
  document.querySelector('#pause').textContent = paused ? '继续控制' : '暂停控制';
  error.hidden = !state.connectionError;
  error.textContent = state.connectionError;
  rows(document.querySelector('#requests'), state.pending, (item) => item.origin, '查看', (item) =>
    chrome.windows.create({ url: chrome.runtime.getURL(`approval.html?id=${item.id}`), type: 'popup', width: 400, height: 520 }));
  rows(document.querySelector('#origins'), state.allowedOrigins, (origin) => origin, '撤销', (origin) =>
    send({ operation: 'revoke', origin }));
}

async function perform(action) {
  try { await action(); await refresh(); }
  catch (caught) { error.hidden = false; error.textContent = caught.message; }
}

document.querySelector('#connect').addEventListener('click', () => perform(() => send({ operation: 'connect' })));
document.querySelector('#pause').addEventListener('click', () => perform(() => send({ operation: 'pause', paused: !paused })));
document.querySelector('#save-name').addEventListener('click', () => perform(() =>
  send({ operation: 'profileName', name: document.querySelector('#name').value })));
const { profileName = 'Chrome' } = await chrome.storage.local.get('profileName');
document.querySelector('#name').value = profileName;
await perform(refresh);
