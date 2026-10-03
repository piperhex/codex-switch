import React, { Children, isValidElement, type ReactNode } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ChatGuiUpdateSheet } from './ChatGuiUpdateSheet';
import type { GuiToolsClient } from '../../../../shared/remote-chat/guiTools';

const update = vi.hoisted(() => ({ version: '0.155.0', release: { version: '0.156.0' },
  available: true, checkLabel: '检查更新',
  confirmation: null as string | null, canCheck: true, canInstall: true, canConfirm: false,
  message: '有新版本可安装。', progress: null as number | null, error: '',
  check: vi.fn(), requestInstall: vi.fn(), cancel: vi.fn(), confirm: vi.fn() }));
vi.mock('../../../../shared/remote-chat/useGuiUpdate', () => ({ useGuiUpdate: () => update }));
vi.mock('react-native', () => ({ ScrollView: 'ScrollView', Text: 'Text', View: 'View',
  StyleSheet: { create: <T,>(value: T) => value } }));
vi.mock('../components/BottomSheet', () => ({ BottomSheet: 'BottomSheet' }));
const props = { client: {} as GuiToolsClient, active: true, connected: true, running: false,
  deviceName: '我的电脑', onClose: vi.fn(), onBack: vi.fn() };
function text(tree: ReactNode): string {
  return Children.toArray(tree).map(child => isValidElement<{ children?: ReactNode }>(child)
    ? text(child.props.children) : String(child)).join('');
}
beforeEach(() => {
  vi.stubGlobal('React', React); vi.clearAllMocks();
  Object.assign(update, { confirmation: null, canCheck: true, canInstall: true,
    canConfirm: false, progress: null, error: '', available: true, checkLabel: '检查更新',
    version: '0.155.0', message: '有新版本可安装。' });
});
afterEach(() => vi.unstubAllGlobals());

it('shows versions for the current computer and opens confirmation instead of installing immediately', () => {
  const sheet = ChatGuiUpdateSheet(props);
  expect(sheet.props.subtitle).toBe('我的电脑'); expect(text(sheet)).toContain('v0.155.0');
  expect(text(sheet)).toContain('v0.156.0');
  expect(sheet.props.children.props.children.props.style.maxWidth).toBe(400);
  sheet.props.actions[1].onPress(); expect(update.requestInstall).toHaveBeenCalledOnce();
  expect(update.confirm).not.toHaveBeenCalled();
});

it('uses guarded confirmation, shows progress and errors, and keeps back navigation available', () => {
  Object.assign(update, { confirmation: '0.156.0', error: '请等任务完成后再安装。', progress: 50 });
  const sheet = ChatGuiUpdateSheet(props);
  expect(sheet.props.title).toBe('安装 Codex GUI 更新');
  expect(sheet.props.actions[1].disabled).toBe(true);
  expect(text(sheet)).toContain('50%'); expect(text(sheet)).toContain(update.error);
  sheet.props.onBack(); expect(update.cancel).toHaveBeenCalledOnce();
  update.canConfirm = true;
  const ready = ChatGuiUpdateSheet(props);
  expect(ready.props.actions[1].disabled).toBe(false);
  ready.props.actions[1].onPress(); expect(update.confirm).toHaveBeenCalledOnce();
});

it('shows a lasting up-to-date result without listing the same version as an available update', () => {
  Object.assign(update, { version: '0.156.0', available: false, canInstall: false,
    checkLabel: '已是最新', message: 'Codex GUI 已是最新版本。' });
  const sheet = ChatGuiUpdateSheet(props);
  expect(text(sheet)).toContain('Codex GUI 已是最新版本。');
  expect(text(sheet)).not.toContain('可用版本');
  expect(sheet.props.actions[0]).toMatchObject({ label: '已是最新', disabled: false });
  expect(sheet.props.actions[1].disabled).toBe(true);
  sheet.props.actions[0].onPress();
  expect(update.check).toHaveBeenCalledOnce();
});

it('shows the in-progress check and disables repeated checks', () => {
  Object.assign(update, { canCheck: false, canInstall: false,
    checkLabel: '正在检查更新…', message: '正在检查更新…' });
  const sheet = ChatGuiUpdateSheet(props);
  expect(text(sheet)).toContain('正在检查更新…');
  expect(sheet.props.actions[0]).toMatchObject({ label: '正在检查更新…', disabled: true });
  expect(sheet.props.actions[1].disabled).toBe(true);
});

vi.mock('react', async () => ({ ...await vi.importActual<typeof import('react')>('react'),

  useSyncExternalStore: (_subscribe: unknown, snapshot: () => unknown) => snapshot(),
}));
