import { authorize } from './permissions.js';

const snapshots = new Map();
const MAX_NODES = 700;
const MAX_TEXT = 120000;

export function invalidate(tabId) {
  for (const [id, snapshot] of snapshots) {
    if (snapshot.tabId === tabId) snapshots.delete(id);
  }
}

export async function frames(driver) {
  return (await driver.documents()).map(({ id, parentId, url, name }) => ({ frameId: id, parentId, url, name }));
}

export async function documentFrame(driver, frameId) {
  const documents = await driver.documents();
  const frame = frameId ? documents.find((frame) => frame.id === frameId) : documents[0];
  if (!frame) throw new Error('页面框架已变化，请重新读取页面。');
  await authorize(frame.url, driver.context.clientId, driver.context.signal);
  return frame;
}

export async function snapshot(driver, args = {}) {
  const frame = await documentFrame(driver, args.frameId);
  const { nodes } = await driver.send('Accessibility.getFullAXTree', { frameId: frame.id }, frame.id);
  const id = crypto.randomUUID();
  const references = new Map();
  const visible = nodes.filter((node) => !node.ignored).slice(0, MAX_NODES);
  await hidePasswordValues(driver, visible, frame.id);
  const lines = visible.map((node) => describeNode(node, references));
  const text = lines.join('\n').slice(0, MAX_TEXT);
  // Keep only a few recent documents per browser; references never resolve across tabs or navigations.
  if (snapshots.size >= 32) snapshots.delete(snapshots.keys().next().value);
  snapshots.set(id, { tabId: driver.tab.id, frameId: frame.id, loaderId: frame.loaderId, references });
  return { tabId: driver.tab.id, url: frame.url, frameId: frame.id, snapshotId: id,
    text: text.replace(/\[node:(\d+)\]/g, (_, node) => `[${id}:${node}]`),
    truncated: nodes.length > MAX_NODES || lines.join('\n').length > MAX_TEXT };
}

async function hidePasswordValues(driver, nodes, frameId) {
  for (const node of nodes) {
    if (!node.value || !['textbox', 'searchbox', 'combobox'].includes(node.role?.value)) continue;
    try {
      const result = await driver.send('DOM.describeNode', { backendNodeId: node.backendDOMNodeId }, frameId);
      const attributes = result.node.attributes ?? [];
      const typeIndex = attributes.indexOf('type');
      if (typeIndex >= 0 && attributes[typeIndex + 1]?.toLowerCase() === 'password') delete node.value;
    } catch {
      // A detached or inaccessible input must not expose a potentially protected value.
      delete node.value;
    }
  }
}

function describeNode(node, references) {
  const role = node.role?.value ?? 'node';
  const name = JSON.stringify(String(node.name?.value ?? '').slice(0, 3000));
  const properties = new Map((node.properties ?? []).map((property) => [property.name, property.value?.value]));
  const protectedValue = properties.get('protected') === true;
  const value = protectedValue ? '' : String(node.value?.value ?? '').slice(0, 2000);
  const states = ['disabled', 'checked', 'selected', 'expanded', 'required']
    .filter((state) => properties.has(state)).map((state) => `${state}=${properties.get(state)}`);
  const nodeId = node.backendDOMNodeId;
  if (nodeId) references.set(nodeId, { nodeId });
  return `${nodeId ? `[node:${nodeId}] ` : ''}${role} ${name}${value ? ` = ${JSON.stringify(value)}` : ''} ${states.join(' ')}`.trim();
}

export async function reference(driver, value) {
  const separator = value?.lastIndexOf(':') ?? -1;
  const entry = snapshots.get(value?.slice(0, separator));
  const nodeId = Number(value?.slice(separator + 1));
  if (!entry || entry.tabId !== driver.tab.id || !entry.references.has(nodeId)) {
    throw new Error('这个页面引用已失效，请重新读取页面。');
  }
  const frame = await documentFrame(driver, entry.frameId);
  if (frame.loaderId !== entry.loaderId) throw new Error('页面已跳转，请重新读取页面。');
  return { nodeId, frameId: entry.frameId };
}
