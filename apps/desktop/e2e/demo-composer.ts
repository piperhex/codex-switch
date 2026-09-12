import { composerPatch, COMPOSER_EVENT, DEFAULT_COMPOSER,
  type ComposerSnapshot } from '../../../shared/remote-chat/composer';
import type { ChatLink } from '../../../shared/remote-chat/link';
import { resolveModelSelection } from '../src/pages/codexGui/modelSelection';

let snapshot: ComposerSnapshot = { revision: 1,
  settings: { ...DEFAULT_COMPOSER, model: 'test-model', effort: 'medium', speed: 'normal' },
  models: ['test-model', 'second-model'].map((model, index) => ({
    id: model, model, displayName: index === 0 ? '测试模型' : '第二模型', isDefault: index === 0,
    defaultReasoningEffort: 'medium', supportedReasoningEfforts: ['medium', 'high', 'xhigh']
      .map((reasoningEffort) => ({ reasoningEffort, description: '' })),
  })) };
export const composerErrors: string[] = [];
export const demoComposer = () => snapshot;

export function changeDemoComposer(input: unknown, link: ChatLink) {
  const patch = composerPatch(input);
  const selection = { ...snapshot.settings, ...patch };
  snapshot = { ...snapshot, revision: snapshot.revision + 1,
    settings: { ...resolveModelSelection(snapshot.models, selection),
      access: selection.access, speed: selection.speed } };
  void link.send({ kind: 'event', event: { method: COMPOSER_EVENT, params: snapshot } })
    .catch((error: unknown) => composerErrors.push(String(error)));
  return snapshot;
}
