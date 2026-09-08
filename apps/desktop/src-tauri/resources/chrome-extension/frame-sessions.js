const MAX_TARGETS = 64;
const AUTO_ATTACH = { autoAttach: true, waitForDebuggerOnStart: false, flatten: true,
  filter: [{ type: 'iframe', exclude: false }] };

// Chrome omits out-of-process frames from the main target's frame tree. Each child session owns a tree.
export function createFrameSessions(target, guard) {
  const state = { target, guard, targets: new Map(), frameSessions: new Map(), pending: new Set(), error: null };
  const listener = (source, method, params) => onEvent(state, { source, method, params });
  chrome.debugger.onEvent.addListener(listener);
  return {
    initialize: async () => { autoAttach(state); await settle(state); },
    documents: () => documents(state),
    send: (method, params = {}, frameId) => {
      if (frameId && !state.frameSessions.has(frameId)) throw new Error('页面框架已变化，请重新读取页面。');
      return command(state, { method, params, sessionId: state.frameSessions.get(frameId) });
    },
    dispose: () => chrome.debugger.onEvent.removeListener(listener),
  };
}

function onEvent(state, { source, method, params }) {
  if (source.tabId !== state.target.tabId) return;
  if (method === 'Target.detachedFromTarget') {
    state.targets.delete(params.sessionId);
    for (const [frameId, sessionId] of state.frameSessions) {
      if (sessionId === params.sessionId) state.frameSessions.delete(frameId);
    }
    return;
  }
  if (method !== 'Target.attachedToTarget' || params.targetInfo.type !== 'iframe') return;
  if (state.targets.has(params.sessionId)) return;
  if (state.targets.size >= MAX_TARGETS) { state.error = new Error('页面框架过多，请关闭无关内容后重试。'); return; }
  state.targets.set(params.sessionId, params.targetInfo.targetId);
  // Auto-attach is not recursive; nested cross-site frames need it enabled in each child session.
  autoAttach(state, params.sessionId);
}

function autoAttach(state, sessionId) {
  const task = command(state, { method: 'Target.setAutoAttach', params: AUTO_ATTACH, sessionId })
    .catch(() => { state.error = new Error('页面框架连接已变化，请重新读取页面。'); })
    .finally(() => state.pending.delete(task));
  state.pending.add(task);
}

async function settle(state) {
  while (state.pending.size) await Promise.all([...state.pending]);
  if (state.error) throw state.error;
}

async function command(state, { method, params = {}, sessionId }) {
  await state.guard();
  return chrome.debugger.sendCommand({ ...state.target, ...(sessionId ? { sessionId } : {}) }, method, params);
}

async function documents(state) {
  await settle(state);
  const result = new Map();
  state.frameSessions.clear();
  const root = await command(state, { method: 'Page.getFrameTree' });
  addTree(state, result, { tree: root.frameTree });
  for (const sessionId of state.targets.keys()) {
    const child = await command(state, { method: 'Page.getFrameTree', sessionId });
    addTree(state, result, { tree: child.frameTree, sessionId });
  }
  return [...result.values()];
}

function addTree(state, result, { tree, sessionId }) {
  const pending = [tree];
  while (pending.length) {
    const current = pending.pop();
    result.set(current.frame.id, current.frame);
    state.frameSessions.set(current.frame.id, sessionId);
    pending.push(...(current.childFrames ?? []));
  }
}
