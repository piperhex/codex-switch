import { assertRunning } from './permissions.js';
import { clearControlledTabs } from './tab-indicator.js';

export const DEBUGGER_IDLE_MS = 5 * 60 * 1000;
const connections = new Map();
const keyOf = target => target.tabId === undefined ? `worker:${target.targetId}` : `tab:${target.tabId}`;

// Callers serialize operations per target. Retain only the transport between operations;
// page overrides, protocol subscriptions and frame sessions remain request-scoped.
export async function acquireConnection(target, signal) {
  const key = keyOf(target);
  let connection = connections.get(key);
  if (connection?.closed) {
    await closeConnection(connection);
    connection = undefined;
  }
  assertRunning(signal);
  if (!connection) {
    connection = { target, key, closed: false, detached: false, timer: null, closing: null };
    connections.set(key, connection);
    connection.attaching = chrome.debugger.attach(target, '1.3');
  }
  clearTimeout(connection.timer);
  try {
    await connection.attaching;
    assertRunning(signal);
    assertConnected(connection);
    return connection;
  } catch (error) {
    await closeConnection(connection);
    throw error;
  }
}

export function assertConnected(connection) {
  if (connection.closed) throw new Error('浏览器连接已结束，请重新操作。');
}

export function releaseConnection(connection, keepAlive) {
  if (!keepAlive || connection.closed) return closeConnection(connection);
  connection.timer = setTimeout(() => { void closeConnection(connection); }, DEBUGGER_IDLE_MS);
}

export function closeConnection(connection) {
  if (connection.closing) return connection.closing;
  connection.closed = true;
  clearTimeout(connection.timer);
  connection.closing = detach(connection).finally(() => {
    if (connections.get(connection.key) === connection) connections.delete(connection.key);
  });
  return connection.closing;
}

async function detach(connection) {
  try {
    await connection.attaching;
    if (!connection.detached) await chrome.debugger.detach(connection.target);
  } catch {
    // Attach failure, tab/worker closure and Chrome's Cancel button can detach first.
  }
  if (connection.target.tabId !== undefined) await clearControlledTabs(connection.target.tabId);
}

export function debuggerDetached(target) {
  const connection = connections.get(keyOf(target));
  if (!connection) return;
  connection.detached = true;
  return closeConnection(connection);
}

export function hasDebuggerConnections() {
  return connections.size > 0;
}

export async function stopConnections() {
  await Promise.all([...connections.values()].map(closeConnection));
}
