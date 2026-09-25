import React, { Children, isValidElement, type ReactNode } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ChatTurnSummary } from './ChatTurnSummary';
import type { Turn } from './types';

vi.mock('react', async original => ({ ...await original<typeof import('react')>(),
  useMemo: <T,>(compute: () => T) => compute(),
}));
vi.mock('react-native', () => ({ Pressable: 'Pressable', Text: 'Text', View: 'View',
  StyleSheet: { create: <T,>(styles: T) => styles },
}));
vi.mock('@expo/vector-icons', () => ({ Ionicons: 'Icon' }));
vi.mock('./ChatImage', () => ({ ChatImage: 'Image' }));

interface Props { children?: ReactNode; accessibilityLabel?: string; onPress?: () => void }
function descendants(node: ReactNode): { type: unknown; props: Props }[] {
  return Children.toArray(node).flatMap(child => {
    if (!isValidElement<Props>(child)) return [];
    if (typeof child.type === 'function') {
      return descendants((child.type as (props: Props) => ReactNode)(child.props));
    }
    return [child, ...descendants(child.props.children)];
  });
}
function content(node: ReactNode): string {
  return Children.toArray(node).map(child => {
    if (!isValidElement<Props>(child)) return String(child);
    if (typeof child.type === 'function') return content((child.type as (props: Props) => ReactNode)(child.props));
    return content(child.props.children);
  }).join('');
}
beforeEach(() => vi.stubGlobal('React', React));
afterEach(() => vi.unstubAllGlobals());

const turn: Turn = { id: 'turn', status: 'inProgress', items: [
  { id: 'edit', type: 'fileChange', status: 'completed', changes: [
    { path: 'src/example.ts', kind: { type: 'update' }, diff: '@@ -1 +1 @@\n-before\n+after\n' },
  ] },
  { id: 'command', type: 'commandExecution', status: 'inProgress', command: 'npm test' },
] };

it('keeps running file edits compact and opens the turn changes when pressed', () => {
  const onOpen = vi.fn();
  const tree = ChatTurnSummary({ turn, onOpen });
  expect(content(tree)).toContain('已编辑 1 个文件+1−1');
  expect(content(tree)).not.toContain('审核');
  expect(content(tree)).not.toContain('src/example.ts');
  descendants(tree).find(node => node.props.accessibilityLabel === '查看本轮修改：1 个文件')?.props.onPress?.();
  expect(onOpen).toHaveBeenCalledWith('turn', 'changes');
});

it.each(['completed', 'interrupted', 'failed'])('restores the file list when the turn is %s', status => {
  const tree = ChatTurnSummary({ turn: { ...turn, status }, onOpen: vi.fn() });
  expect(content(tree)).toContain('审核');
  expect(content(tree)).toContain('src/example.ts');
});
