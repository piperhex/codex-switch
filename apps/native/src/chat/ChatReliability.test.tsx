import React, { Children, isValidElement, type ReactNode } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ChatTaskStatus } from './ChatTaskStatus';
import { ChatConnectionHealth } from './ChatConnectionHealth';
import { initialChatState } from './types';

vi.mock('../i18n', () => ({ t: (value: string) => value, useLanguage() {} }));
vi.mock('react-native', () => ({ Pressable: 'Pressable', View: 'View', Text: 'Text',
  StyleSheet: { create: <T,>(value: T) => value } }));
vi.mock('../components/BottomSheet', () => ({ BottomSheet: 'BottomSheet' }));
beforeEach(() => vi.stubGlobal('React', React));
afterEach(() => vi.unstubAllGlobals());

function text(node: ReactNode): string {
  return Children.toArray(node).map(child => {
    if (!isValidElement<{ children?: ReactNode }>(child)) return String(child);
    return text(child.props.children);
  }).join(' ');
}

it('renders the native connection check within the compact sheet width', () => {
  const view = ChatConnectionHealth({ state: { ...initialChatState(), mode: 'relay', ready: true },
    device: { online: true }, reconnect: vi.fn(), close: vi.fn() });
  expect(view.props.maxWidth).toBe(400);
  const content = text(view);
  expect(content).toContain('已通过中转连接');
  expect(content).toContain('聊天可正常使用');
  expect(content).toContain('电脑聊天');
});

it('renders uncertain delivery and disk failure without claiming task completion', () => {
  const state = { ...initialChatState(), notificationError: true,
    selected: { id: 'thread', cwd: '', preview: '', updatedAt: 0,
      turns: [{ id: 'old', status: 'completed', items: [] }] },
    deliveries: { thread: { requestId: 'send', threadId: 'thread', phase: 'unknown' as const } } };
  const content = text(ChatTaskStatus({ state }));
  expect(content).toContain('发送结果待核实');
  expect(content).toContain('避免重复发送');
  expect(content).toContain('部分提醒未能保存');
  expect(content).not.toContain('结果待确认');
});
