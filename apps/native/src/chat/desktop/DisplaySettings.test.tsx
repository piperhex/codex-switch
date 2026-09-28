import React, { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { DisplaySettings } from './DisplaySettings';
import { DEFAULT_SETTINGS, type DesktopDisplay } from '../../../../../shared/remote-desktop/protocol';

vi.mock('react', async () => ({ ...await vi.importActual<typeof import('react')>('react'),
  useState: (value: unknown) => [value, vi.fn()] }));
vi.mock('react-native', () => ({ View: 'View', Pressable: 'Pressable', Text: 'Text',
  ScrollView: 'ScrollView', TextInput: 'TextInput', StyleSheet: { create: <T,>(value: T) => value } }));
interface Props {
  children?: ReactNode; accessibilityRole?: string; accessibilityLabel?: string;
  accessibilityState?: { checked?: boolean; disabled?: boolean }; onPress?: () => void; disabled?: boolean;
}
function nodes(tree: ReactNode): ReactElement<Props>[] {
  return Children.toArray(tree).flatMap(child => isValidElement<Props>(child)
    ? [child, ...nodes(child.props.children)] : []);
}
const displays: DesktopDisplay[] = [
  { id: 'first', name: 'DISPLAY1', primary: true, width: 1920, height: 1080 },
  { id: 'second', name: 'DISPLAY2', primary: false, width: 1080, height: 1920 },
];
afterEach(() => vi.unstubAllGlobals());

it.each([false, true])('shows selected display, wraps labels and prevents repeat switches while saving=%s', saving => {
  vi.stubGlobal('React', React);
  const update = vi.fn(async () => {});
  const tree = nodes(DisplaySettings({ settings: { ...DEFAULT_SETTINGS, displayId: 'first' }, displays,
    update, saving, close: vi.fn(), stats: { visible: true, toggle: vi.fn() } }));
  const first = tree.find(node => node.props.accessibilityLabel === '显示器 1 · 主屏 · 1920 × 1080')!;
  const second = tree.find(node => node.props.accessibilityLabel === '显示器 2 · 1080 × 1920')!;
  expect(first.props.accessibilityState).toEqual({ checked: true, disabled: saving });
  expect(second.props.accessibilityState).toEqual({ checked: false, disabled: saving });
  expect(second.props.disabled).toBe(saving);
  if (!saving) {
    second.props.onPress!();
    expect(update).toHaveBeenCalledWith({ ...DEFAULT_SETTINGS, displayId: 'second' });
  }
});
