import { beforeEach, expect, it, vi } from 'vitest';
import { RemoteComposerSettings } from '../../../../shared/remote-chat/client/composerSettings';
import { initialChatState, type ChatState, type Thread } from '../../../../shared/remote-chat/client/types';
import type { ComposerSettings, ComposerSnapshot } from '../../../../shared/remote-chat/composer';

const thread = (id: string): Thread => ({ id, preview: id, cwd: '', updatedAt: 1 });
const models = [{ id: 'model', model: 'model', displayName: 'Model', isDefault: true,
  defaultReasoningEffort: 'low', supportedReasoningEfforts: ['low', 'high', 'xhigh'].map(reasoningEffort =>
    ({ reasoningEffort, description: '' })) }];
let state: ChatState;
let composer: RemoteComposerSettings;
let saved: Map<string | null, ComposerSnapshot>;
const request = vi.fn();
const snapshot = (threadId: string | null, effort = 'high', revision = 1): ComposerSnapshot => ({
  threadId, models, settings: { model: 'model', effort, access: 'workspace-write' }, revision,
});
beforeEach(() => {
  state = { ...initialChatState(), ready: true };
  saved = new Map([[null, snapshot(null, 'low')], ['a', snapshot('a')], ['b', snapshot('b', 'xhigh')]]);
  request.mockReset().mockImplementation(async (body: {
    operation: string; threadId: string | null; settings?: Partial<ComposerSettings>;
  }) => {
    const current = saved.get(body.threadId) ?? snapshot(body.threadId, 'low');
    if (body.operation === 'models') return { data: models, nextCursor: null, composer: current };
    const updated = { ...current, revision: current.revision + 1, settings: { ...current.settings, ...body.settings } };
    saved.set(body.threadId, updated); return updated;
  });
  composer = new RemoteComposerSettings({ snapshot: () => state, ready: () => state.ready,
    update: patch => { state = { ...state, ...patch }; }, request });
});

async function select(id: string) { state.selected = thread(id); await composer.select(); }

it('ignores another PC conversation and global legacy events after scoped synchronization', async () => {
  await composer.load(); await select('a');
  composer.receive(snapshot(null, 'low', 100));
  composer.receive(snapshot('pc', 'low', 101));
  const legacy = snapshot(null, 'low', 102); delete legacy.threadId;
  composer.receive(legacy);
  expect(state.settings.effort).toBe('high');
  composer.receive(snapshot('a', 'xhigh', 3));
  expect(state.settings.effort).toBe('xhigh');
});

it('keeps a slow save on its original conversation while another conversation is opened', async () => {
  await composer.load(); await select('a');
  let finish!: (value: ComposerSnapshot) => void;
  request.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  composer.set({ effort: 'xhigh' });
  await select('b');
  expect(state.settings.effort).toBe('xhigh');
  finish(snapshot('a', 'xhigh', 2));
  await vi.waitFor(() => expect(state.settingsBusy).toBe(false));
  expect(state.selected?.id).toBe('b');
  expect(request).toHaveBeenCalledWith({ operation: 'composerSet', threadId: 'a', settings: { effort: 'xhigh' } });
});

it('blocks sending during a delayed read and keeps newer events ahead of the stale response', async () => {
  await composer.load();
  let finish!: (value: unknown) => void;
  request.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const selecting = select('a');
  expect(state.settingsBusy).toBe(true);
  composer.receive(snapshot('a', 'high', 3));
  expect(state.settingsBusy).toBe(true);
  finish({ composer: snapshot('a', 'low', 2) }); await selecting;
  expect(state.settings.effort).toBe('high');
  expect(state.settingsBusy).toBe(false);
});

it('uses the current choice for a new draft and saves a phone-created conversation separately', async () => {
  await composer.load(); await select('a');
  composer.set({ access: 'danger-full-access' });
  await vi.waitFor(() => expect(state.settingsBusy).toBe(false));
  const selection = { ...state.settings };
  state.selected = null;
  await composer.select(selection);
  await vi.waitFor(() => expect(state.settingsBusy).toBe(false));
  expect(state.settings.effort).toBe('high');
  expect(state.settings.access).toBe('danger-full-access');
  state.selected = thread('created');
  await composer.created('created', selection);
  expect(saved.get('created')?.settings.effort).toBe('high');
  expect(saved.get(null)?.settings.effort).toBe('high');
  expect(saved.get('created')?.settings.access).toBe('danger-full-access');
  expect(saved.get(null)?.settings.access).toBe('danger-full-access');
});

it('retries offline edits in their original scope and ignores responses from before reconnecting', async () => {
  await composer.load(); await select('a');
  state.ready = false; composer.reset(); composer.set({ effort: 'xhigh' });
  await select('b');
  state.ready = true; await composer.load(); composer.retry();
  await vi.waitFor(() => expect(saved.get('a')?.settings.effort).toBe('xhigh'));
  expect(state.selected?.id).toBe('b');
  expect(state.settings.effort).toBe('xhigh');
});

it('does not deadlock reads when rapidly switching back to a conversation still loading', async () => {
  await composer.load();
  const finish = new Map<string, (value: unknown) => void>();
  request.mockImplementation((body: { threadId: string }) => new Promise(resolve => finish.set(body.threadId, resolve)));
  const a = select('a'); const b = select('b'); const back = select('a');
  finish.get('a')!({ composer: snapshot('a') });
  finish.get('b')!({ composer: snapshot('b', 'low') });
  await Promise.all([a, b, back]);
  expect(state.selected?.id).toBe('a');
  expect(state.settings.effort).toBe('high');
  expect(state.settingsBusy).toBe(false);
});
