import { expect, it } from 'vitest';
import { fileArea, fileTree, selectionState, toggleFiles } from '../../../../shared/remote-chat/gitFiles';
import type { GitChange } from '../../../../shared/remote-chat/gitTypes';

const file = (path: string, status = ' M'): GitChange =>
  ({ path, status, originalPath: null, conflict: status === 'UU', version: path });

it('distinguishes index, worktree, mixed, new and conflicted changes', () => {
  expect([' M', 'M ', 'MM', '??', 'UU', ' D', 'R ', 'AM'].map(status => fileArea(file('x', status))))
    .toEqual(['unstaged', 'staged', 'mixed', 'untracked', 'conflict', 'unstaged', 'staged', 'mixed']);
});

it('selects descendants together without losing unrelated choices, and reports partial selection', () => {
  const files = [file('src/深层/a.ts'), file('src/深层/b.ts'), file('src/conflict.ts', 'UU'), file('README.md')];
  const tree = fileTree(files);
  expect(tree.map(node => node.name)).toEqual(['src', 'README.md']);
  const nested = tree[0].children.find(node => node.name === '深层')!;
  expect(nested.files).toHaveLength(2);
  let selected = toggleFiles({}, [files[3], files[0]]);
  expect(selectionState(nested.files, selected)).toBe('mixed');
  selected = toggleFiles(selected, nested.files);
  expect(selectionState(nested.files, selected)).toBe(true);
  expect(selected['README.md']).toBeTruthy();
  selected = toggleFiles(selected, tree[0].files);
  expect(selected).toEqual({ 'README.md': 'README.md' });
  expect(toggleFiles({}, files)).not.toHaveProperty('src/conflict.ts');
});
