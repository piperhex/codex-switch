import React, { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DesktopVersionContent } from './DesktopVersionSheet';
import type { useDesktopUpdate } from '../../../../shared/desktop-update/useDesktopUpdate';

const state = vi.hoisted(() => ({ confirmation: null as { deviceId: string; version: string } | null }));
vi.mock('react', async (original) => ({ ...await original<typeof React>(),
  useState: () => [state.confirmation, (value: typeof state.confirmation) => { state.confirmation = value; }] }));
vi.mock('react-native', () => ({ Pressable: 'Pressable', ScrollView: 'ScrollView', Text: 'Text', View: 'View',
  StyleSheet: { create: <T,>(value: T) => value } }));
vi.mock('../components/BottomSheet', () => ({ BottomSheet: 'BottomSheet' }));
vi.mock('../api/client', () => ({ fetchUserProfile: vi.fn() }));
beforeEach(() => { state.confirmation = null; vi.stubGlobal('React', React); });
afterEach(() => vi.unstubAllGlobals());

function model(): ReturnType<typeof useDesktopUpdate> {
  const device = { deviceId: 'pc', name: '我的电脑', platform: 'windows',
    online: true, capabilities: ['app-update'] };
  return { devices: [device], device, selectedId: 'pc', connected: true, busy: false, checked: true, updated: false,
    error: '', message: '有新版本可安装。', canCheck: true, canInstall: true,
    status: { currentVersion: '1.0.0', latestVersion: '2.0.0', notes: null, phase: 'available', progress: null, error: null },
    select: vi.fn(), check: vi.fn(), install: vi.fn() };
}
function text(tree: ReactNode): string {
  return Children.toArray(tree).map((child) => isValidElement<{ children?: ReactNode }>(child)
    ? text(child.props.children) : String(child)).join('');
}
interface NodeProps { children?: ReactNode; accessibilityState?: { checked: boolean }; onPress?: () => void }
function buttons(tree: ReactNode): ReactElement<NodeProps>[] {
  return Children.toArray(tree).flatMap((child) => isValidElement<NodeProps>(child)
    ? [child, ...buttons(child.props.children)] : []);
}

it('shows computer versions and requires a separate compact confirmation before install', () => {
  const update = model(); const props = { update, onClose: vi.fn() };
  const sheet = DesktopVersionContent(props);
  expect(text(sheet)).toContain('当前版本1.0.0'); expect(text(sheet)).toContain('v2.0.0');
  expect(sheet.props.children.props.children.props.style.maxWidth).toBe(400);
  sheet.props.actions[1].onPress(); expect(update.install).not.toHaveBeenCalled();
  const confirm = DesktopVersionContent(props);
  expect(text(confirm)).toContain('请先保存工作');
  confirm.props.actions[1].onPress(); expect(update.install).toHaveBeenCalledExactlyOnceWith('2.0.0');
});

it('disables unavailable actions and never confirms against a different device or version', () => {
  const update = model(); update.canCheck = false; update.canInstall = false;
  const sheet = DesktopVersionContent({ update, onClose: vi.fn() });
  expect(sheet.props.actions.every((action: { disabled?: boolean }) => action.disabled)).toBe(true);
  expect(buttons(sheet).some((button) => button.props.accessibilityState?.checked)).toBe(true);
  update.canInstall = true; state.confirmation = { deviceId: 'other', version: '2.0.0' };
  const confirm = DesktopVersionContent({ update, onClose: vi.fn() });
  expect(confirm.props.actions[1].disabled).toBe(true);
  confirm.props.actions[1].onPress(); expect(update.install).not.toHaveBeenCalled();
});
