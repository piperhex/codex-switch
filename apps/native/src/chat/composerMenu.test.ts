import { expect, it } from 'vitest';
import { insertPluginTrigger, nativeComposerTrigger } from './composerTrigger';
import { MAX_CHAT_FILE_BYTES, remoteAttachments } from '../../../../shared/remote-chat/composerAttachments';
import { remotePlugins } from '../../../../shared/remote-chat/composerCatalog';

it('opens plugin search at the caret and leaves emails and slash commands intact', () => {
  expect(nativeComposerTrigger('请用 @image 后面', { start: 9, end: 9 }))
    .toMatchObject({ start: 3, end: 9, query: 'image', plugins: true });
  expect(nativeComposerTrigger('a@example.com', { start: 13, end: 13 })).toBeNull();
  expect(nativeComposerTrigger('/compact', { start: 8, end: 8 })?.plugins).toBe(false);
  expect(insertPluginTrigger('保留文字', { start: 2, end: 2 }))
    .toEqual({ text: '保留 @文字', selection: { start: 4, end: 4 } });
});

it('retains phone bytes, project references and plugins without accepting malformed attachments', () => {
  const phone = { kind: 'file', name: 'note.txt', path: '', data: 'aGVsbG8=' };
  const project = { kind: 'file', name: 'photo.png', path: 'C:/project/photo.png' };
  const plugin = { kind: 'plugin', name: 'GitHub', path: 'plugin://github@openai' };
  expect(remoteAttachments([phone, project, plugin])).toEqual([phone, project, plugin]);
  for (const item of [{ ...phone, data: '?' }, { ...phone, path: project.path },
    { ...plugin, data: phone.data }, { ...plugin, path: 'plugin://../../bad' },
    { ...phone, data: 'A'.repeat(Math.ceil(MAX_CHAT_FILE_BYTES / 3) * 4 + 4) }]) {
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
