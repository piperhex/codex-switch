import React, { Children, isValidElement, type ReactNode } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { TaskReviewChecks } from './TaskReviewChecks';
import { TaskReviewRestore } from './TaskReviewDelivery';
import type { TaskReviewModel } from '../../../../../shared/remote-chat/useTaskReview';

vi.mock('react', async original => ({ ...await original<typeof import('react')>(),
  useState: <T,>(initial: T) => [initial, vi.fn()],
  useSyncExternalStore: (_subscribe: unknown, snapshot: () => unknown) => snapshot(),
}));
vi.mock('react-native', () => ({ Pressable: 'Pressable', Text: 'Text', View: 'View', ScrollView: 'ScrollView',
  StyleSheet: { create: <T,>(styles: T) => styles },
}));
interface Props { children?: ReactNode; disabled?: boolean; onPress?: () => void }
function nodes(node: ReactNode): { type: unknown; props: Props }[] {
  return Children.toArray(node).flatMap(child => {
    if (!isValidElement<Props>(child)) return [];
    if (typeof child.type === 'function') return nodes((child.type as (props: Props) => ReactNode)(child.props));
    return [child, ...nodes(child.props.children)];
  });
}
function text(node: ReactNode): string {
  return Children.toArray(node).map(child => {
    if (!isValidElement<Props>(child)) return String(child);
    if (typeof child.type === 'function') return text((child.type as (props: Props) => ReactNode)(child.props));
    return text(child.props.children);
  }).join('');
}
const snapshot = { revision: { id: 'current', head: 'head', branch: 'feature', dirty: true },
  commands: [{ kind: 'test' as const, command: 'npm run test' }], checks: [] };
// These presentational components only read their selected model fields; no hook or remote client runs here.
const model = { snapshot, enabled: true, busy: false, running: false, restored: false, restore: null,
  previewRestore: vi.fn(), confirmRestore: vi.fn() } as unknown as TaskReviewModel;
beforeEach(() => vi.stubGlobal('React', React));
afterEach(() => vi.unstubAllGlobals());

it('shows unrun checks and does not present an old successful receipt as current', () => {
  expect(text(TaskReviewChecks({ model })).match(/未运行/g)).toHaveLength(3);
  const stale: TaskReviewModel = { ...model, snapshot: { ...snapshot, checks: [
    { kind: 'test', command: 'npm run test', status: 'passed', revision: 'old', finishedRevision: 'old',
      startedAt: 1, exitCode: 0, output: 'passed' },
  ] } };
  const content = text(TaskReviewChecks({ model: stale }));
  expect(content).toContain('结果已过期');
  expect(content).not.toContain('test通过');
  const offline = nodes(TaskReviewChecks({ model: { ...model, enabled: false } }));
  expect(offline.find(node => node.type === 'Pressable')?.props.disabled).toBe(true);
});

it('shows affected paths and prevents restore confirmation when the preview finds conflicts', () => {
  const tree = TaskReviewRestore({ model: { ...model,
    restore: { version: 'preview', files: ['src/app.ts'], conflict: true } } });
  expect(text(tree)).toContain('src/app.ts');
  expect(text(tree)).toContain('文件已有其他修改，无法安全恢复');
  const confirm = nodes(tree).find(node => node.type === 'Pressable'
    && text(node.props.children) === '确认恢复本轮修改');
  expect(confirm?.props.disabled).toBe(true);
});
