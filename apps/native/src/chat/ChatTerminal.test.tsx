import React, { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ChatTerminal } from './ChatTerminal';
import type { GuiToolsClient } from '../../../../shared/remote-chat/guiTools';
import { palette } from './styles';

const panel = vi.hoisted(() => ({ tabs: [], selected: '', open: false, busy: false, error: '',
  toggle: vi.fn(), hide: vi.fn(), retry: vi.fn() }));
vi.mock('../../../../shared/remote-chat/useRemoteTerminalLauncher', () => ({ useRemoteTerminalLauncher: () => panel }));
vi.mock('../../../../shared/remote-chat/useToolLaunch', () => ({ useToolLaunch: vi.fn() }));
vi.mock('react-native', () => ({ Pressable: 'Pressable', Text: 'Text', ScrollView: 'ScrollView',
  ActivityIndicator: 'Spinner', Keyboard: { dismiss: vi.fn() }, StyleSheet: { create: <T,>(value: T) => value } }));
vi.mock('@expo/vector-icons', () => ({ Ionicons: 'Icon' }));
vi.mock('../components/BottomSheet', () => ({ BottomSheet: 'BottomSheet' }));
vi.mock('./terminal/TerminalSession', () => ({ TerminalSession: 'TerminalSession' }));

interface Props {
  children?: ReactNode; disabled?: boolean; onPress?: () => void; visible?: boolean; color?: string;
  actions?: { disabled: boolean; onPress: () => void }[];
}
function nodes(tree: ReactNode): ReactElement<Props>[] {
  return Children.toArray(tree).flatMap(child => isValidElement<Props>(child)
    ? [child, ...nodes(child.props.children)] : []);
}
const render = (connected = false) => ChatTerminal({ client: {} as GuiToolsClient['terminal'],
  cwd: '/project', active: true, connected });
beforeEach(() => {
  vi.stubGlobal('React', React);
  Object.assign(panel, { open: false, busy: false, error: '' });
  vi.clearAllMocks();
});
afterEach(() => vi.unstubAllGlobals());

it('keeps offline errors behind an enabled red terminal icon until the drawer opens', () => {
  panel.error = '无法读取电脑上的终端，请稍后重试。';
  const tree = render();
  const children = Children.toArray(tree.props.children).filter(isValidElement);
  expect(children.some(child => child.type === 'Text')).toBe(false);
  const elements = nodes(tree);
  expect(elements.find(node => node.type === 'Icon')?.props.color).toBe(palette.danger);
  const button = elements.find(node => node.type === 'Pressable')!;
  expect(button.props.disabled).toBe(false);
  button.props.onPress?.();
  expect(panel.toggle).toHaveBeenCalledOnce();
  expect(elements.find(node => node.type === 'BottomSheet')?.props.visible).toBe(false);
  panel.open = true;
  const sheet = nodes(render()).find(node => node.type === 'BottomSheet')!;
  expect(sheet.props.visible).toBe(true);
  expect(nodes(sheet).some(node => node.props.children === panel.error)).toBe(true);
  expect(sheet.props.actions?.[0].disabled).toBe(true);
});

it('enables an explicit retry after connecting and restores the normal icon when the error clears', () => {
  panel.open = true;
  panel.error = '终端暂时无法连接，请确认电脑在线后重试。';
  const sheet = nodes(render(true)).find(node => node.type === 'BottomSheet')!;
  expect(sheet.props.actions?.[0].disabled).toBe(false);
  sheet.props.actions?.[0].onPress();
  expect(panel.retry).toHaveBeenCalledOnce();
  panel.error = '';
  expect(nodes(render(true)).find(node => node.type === 'Icon')?.props.color).toBe(palette.ink);
});
