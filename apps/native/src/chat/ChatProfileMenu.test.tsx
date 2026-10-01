import React, { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ChatProfileMenu } from './ChatProfileMenu';
import { ChatGuiUpdateSheet } from './ChatGuiUpdateSheet';
import type { GuiToolsClient } from '../../../../shared/remote-chat/guiTools';
import type { GuiAccountsClient } from '../../../../shared/remote-chat/guiAccounts';

const state = vi.hoisted(() => ({ panel: 'profile' as string | null }));
vi.mock('react', async original => ({ ...await original<typeof React>(), useEffect: vi.fn(),
  useState: (initial: unknown) => initial === null
    ? [state.panel, (value: string | null) => { state.panel = value; }] : ['', vi.fn()] ,
  useSyncExternalStore: (_subscribe: unknown, snapshot: () => unknown) => snapshot(),
}));
vi.mock('react-native', () => ({ Pressable: 'Pressable', Text: 'Text', TextInput: 'Input', View: 'View',
  ActivityIndicator: 'Spinner', StyleSheet: { create: <T,>(value: T) => value } }));
vi.mock('@expo/vector-icons/Feather', () => ({ default: 'Icon' }));
vi.mock('../components/BottomSheet', () => ({ BottomSheet: 'BottomSheet' }));
vi.mock('../../../../shared/remote-chat/client/useGuiAccounts', () => ({ useGuiAccounts: () => ({
  loading: false, saving: false, snapshot: null, error: '', refresh: vi.fn(), select: vi.fn(),
}) }));
interface NodeProps {
  children?: ReactNode; accessibilityLabel?: string; onPress?: () => void; client?: GuiToolsClient;
  connected?: boolean; running?: boolean; onBack?: () => void;
}
function nodes(tree: ReactNode): ReactElement<NodeProps>[] {
  return Children.toArray(tree).flatMap(child => isValidElement<NodeProps>(child)
    ? [child, ...nodes(child.props.children)] : []);
}
const props = { client: {} as GuiAccountsClient, guiTools: {} as GuiToolsClient, email: 'test@example.test',
  active: true, ready: false, running: true, chooseDevice: vi.fn(), openTokenSummary: vi.fn() };
beforeEach(() => { state.panel = 'profile'; vi.stubGlobal('React', React); });
afterEach(() => vi.unstubAllGlobals());

it('opens GUI updates from the avatar and forwards this computer connection and task state', () => {
  const entry = nodes(ChatProfileMenu(props)).find(node => node.props.accessibilityLabel === '更新 Codex GUI');
  expect(entry).toBeDefined(); entry?.props.onPress?.();
  const sheet = nodes(ChatProfileMenu(props)).find(node => node.type === ChatGuiUpdateSheet);
  expect(sheet?.props.client).toBe(props.guiTools); expect(sheet?.props.connected).toBe(false);
  expect(sheet?.props.running).toBe(true);
  const inactive = nodes(ChatProfileMenu({ ...props, active: false }));
  expect(inactive.some(node => node.type === ChatGuiUpdateSheet)).toBe(false);
  sheet?.props.onBack?.(); expect(state.panel).toBe('profile');
});
