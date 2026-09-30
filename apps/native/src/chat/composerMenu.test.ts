import { expect, it } from 'vitest';
import { composerMenuTrigger } from './composerTrigger';
import { remoteAttachments } from '../../../../shared/remote-chat/composerAttachments';
import { fileUploadByteLimit } from '../../../../shared/remote-chat/policy';
import { remotePlugins } from '../../../../shared/remote-chat/composerCatalog';

it('opens conversation search at the caret and leaves emails, selections and commands intact', () => {
  expect(composerMenuTrigger('请用 @设计 后面', { start: 6, end: 6 }))
    .toMatchObject({ start: 3, end: 6, query: '设计', conversations: true });
  expect(composerMenuTrigger('@', { start: 1, end: 1 })).toMatchObject({ conversations: true, query: '' });
  expect(composerMenuTrigger('a@example.com', { start: 13, end: 13 })).toBeNull();
  expect(composerMenuTrigger('@设计', { start: 1, end: 3 })).toBeNull();
  expect(composerMenuTrigger('/compact', { start: 8, end: 8 })).toMatchObject({ conversations: false });
  expect(composerMenuTrigger('$skill', { start: 6, end: 6 }))
    .toMatchObject({ conversations: false, skillsOnly: true });
});

it('keeps conversation references in the mobile send payload and rejects file-like reference paths', () => {
  const reference = { kind: 'conversation', name: '设计讨论 gypqj', path: 'codex-thread://design' };
  expect(remoteAttachments([reference])).toEqual([reference]);
  expect(() => remoteAttachments([{ ...reference, path: 'codex-thread://../private' }])).toThrow();
  expect(() => remoteAttachments([{ ...reference, data: 'aGVsbG8=' }])).toThrow();
});

it('retains phone bytes, project references and plugins without accepting malformed attachments', () => {
  const phone = { kind: 'file', name: 'note.txt', path: '', data: 'aGVsbG8=' };
  const project = { kind: 'file', name: 'photo.png', path: 'C:/project/photo.png' };
  const plugin = { kind: 'plugin', name: 'GitHub', path: 'plugin://github@openai' };
  expect(remoteAttachments([phone, project, plugin])).toEqual([phone, project, plugin]);
  for (const item of [{ ...phone, data: '?' }, { ...phone, path: project.path },
    { ...plugin, data: phone.data }, { ...plugin, path: 'plugin://../../bad' },
    { ...phone, data: 'A'.repeat(Math.ceil(fileUploadByteLimit() / 3) * 4 + 4) }]) {
    expect(() => remoteAttachments([item])).toThrow();
  }
});

it('includes only usable plugins and omits large icons', () => {
  const plugin = { id: 'github', name: 'GitHub', installed: true, enabled: true, iconUrl: 'x'.repeat(100_000) };
  const plugins = remotePlugins({ marketplaces: [{ plugins: [plugin, { ...plugin, enabled: false }] }],
    marketplaceLoadErrors: [] });
  expect(plugins).toHaveLength(1);
  expect(plugins[0].name).toBe('GitHub');
  expect(JSON.stringify(plugins).length).toBeLessThan(1000);
});
