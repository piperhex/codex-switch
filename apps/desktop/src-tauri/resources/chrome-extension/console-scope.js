import { authorize } from './permissions.js';
import { website } from './validation.js';

const MAX_SCOPE_FRAMES = 128;

function documentWebsite(frame) {
  if (frame.url === 'about:blank' || frame.url === 'about:srcdoc') return website(frame.securityOrigin).href;
  return website(frame.url).href;
}

// Log events have no frame ID. Authorize every document sharing the selected renderer before reading them.
export async function rendererScope(driver, frameId) {
  const documents = await driver.documents();
  const ids = driver.relatedFrames(frameId);
  const frames = documents.filter(frame => ids.includes(frame.id));
  if (frames.length > MAX_SCOPE_FRAMES) throw new Error('页面框架过多，请减少嵌入页面后重试。');
  for (const frame of frames) {
    await authorize(documentWebsite(frame), driver.context.clientId, driver.context.signal);
  }
  return frames;
}

export async function verifyRendererScope(driver, scope, frameId) {
  const current = await rendererScope(driver, frameId);
  const unchanged = current.length === scope.length && scope.every(frame => current.some(candidate =>
    candidate.id === frame.id && candidate.loaderId === frame.loaderId && candidate.url === frame.url));
  if (!unchanged) throw new Error('页面已变化，请重新读取日志。');
}
