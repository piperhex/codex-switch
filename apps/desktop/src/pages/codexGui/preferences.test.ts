// @vitest-environment jsdom
import { beforeEach, expect, it } from 'vitest';
import { initialState, savePreferences } from './preferences';

const STORAGE_KEY = 'codex-switch:gui';
beforeEach(() => localStorage.clear());

it.each(['read-only', 'workspace-write', 'danger-full-access'] as const)(
  'restores the last selected access mode %s along with other preferences', (access) => {
    const state = initialState();
    state.settings = { cwd: '/project', model: 'model', effort: 'high', access };
    state.selected = 'thread';
    state.pins = ['thread'];
    savePreferences(state);
    expect(initialState()).toMatchObject({ selected: 'thread', pins: ['thread'],
      settings: { cwd: '/project', access } });
  },
);

it.each([undefined, null, '', 'invalid', 1, {}, ['danger-full-access']])(
  'uses the default permission when saved access is missing or invalid: %j', (access) => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ access, cwd: '/project' }));
    expect(initialState().settings).toMatchObject({ cwd: '/project', access: 'workspace-write' });
  },
);

it('uses default permissions when preferences cannot be parsed', () => {
  localStorage.setItem(STORAGE_KEY, '{');
  expect(initialState().settings.access).toBe('workspace-write');
});
