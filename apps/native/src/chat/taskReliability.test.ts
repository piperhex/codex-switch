import { afterEach, expect, it, vi } from 'vitest';
import { ChatRpc } from '../../../../shared/remote-chat/rpc';
import type { RpcMessage } from '../../../../shared/remote-chat/protocol';
import { mergeTaskDelivery, type TaskDelivery } from '../../../../shared/remote-chat/taskDelivery';
import { taskIssue, taskStatus } from '../../../../shared/remote-chat/taskStatus';
import { connectionHealth } from '../../../../shared/remote-chat/connectionHealth';
import { CONNECTION_ERRORS } from '../../../../shared/remote-chat/connectionErrors';
import { initialChatState, type ChatState } from './types';

afterEach(() => vi.useRealTimers());

function rpcHarness() {
  const deliveries: TaskDelivery[] = [];
  let outbound!: RpcMessage;
  let transfer!: () => void;
  const rpc = new ChatRpc({ prefix: 'test', event: () => {}, delivery: value => deliveries.push(value),
    send: message => { outbound = message; return new Promise<void>(resolve => { transfer = resolve; }); } });
  const send = () => rpc.request('request', { operation: 'send', threadId: 'thread', text: 'task' });
  const reply = (error?: string) => {
    if (outbound.kind !== 'request') throw new Error('expected request');
    rpc.receive({ kind: 'response', id: outbound.id, data: {}, error });
  };
  return { rpc, deliveries, send, reply, transfer: () => transfer() };
}

it('distinguishes sending, transport completion and PC acceptance', async () => {
  const h = rpcHarness();
  const request = h.send();
  expect(h.deliveries.map(value => value.phase)).toEqual(['sending']);
  h.transfer(); await Promise.resolve();
  expect(h.deliveries.map(value => value.phase)).toEqual(['sending', 'sent']);
  h.reply(); await request;
  expect(h.deliveries.at(-1)?.phase).toBe('received');
  h.rpc.close();
});

it('does not regress after a response beats the transport promise', async () => {
  const h = rpcHarness();
  const request = h.send();
  h.reply(); await request;
  h.transfer(); await Promise.resolve();
  expect(h.deliveries.map(value => value.phase)).toEqual(['sending', 'received']);
});

it.each(['close', 'timeout', 'error'])('reports an unknown outcome after %s without resending', async reason => {
  vi.useFakeTimers();
  const h = rpcHarness();
  const request = h.send().catch(() => undefined);
  h.transfer(); await Promise.resolve();
  if (reason === 'close') h.rpc.close();
  else if (reason === 'error') h.reply('保存结果尚未确认');
  else await vi.runAllTimersAsync();
  await request;
  expect(h.deliveries.at(-1)?.phase).toBe('unknown');
  expect(h.deliveries.filter(value => value.phase === 'sending')).toHaveLength(1);
  expect(vi.getTimerCount()).toBe(0);
});

it('ignores late callbacks from an older send in the same thread', () => {
  const current: TaskDelivery = { requestId: 'new', threadId: 'thread', phase: 'sent' };
  expect(mergeTaskDelivery(current, { ...current, requestId: 'old', phase: 'unknown' })).toBe(current);
  expect(mergeTaskDelivery({ ...current, phase: 'received' }, current).phase).toBe('received');
});

function state(): ChatState {
  return { ...initialChatState(), ready: true, mode: 'relay', selected: {
    id: 'thread', cwd: '', preview: '', updatedAt: 1,
    turns: [{ id: 'old', status: 'completed', items: [{ id: 'u', type: 'userMessage' }] }],
  } };
}

it('never treats a previous completed turn as the result of a newly accepted message', () => {
  const value = state();
  value.deliveries = { thread: { requestId: 'send', threadId: 'thread', phase: 'received',
    afterTurnId: 'old', afterUserCount: 1 } };
  expect(taskStatus(value)?.label).toBe('电脑已收到');
  expect(taskIssue(value)).toBeUndefined();
  value.selected!.turns!.push({ id: 'new', status: 'inProgress', items: [] });
  expect(taskStatus(value)?.label).toBe('AI 已开始处理');
  expect(taskIssue(value)).toBeUndefined();
  value.selected!.turns!.at(-1)!.status = 'completed';
  expect(taskStatus(value)?.label).toBe('结果待确认');
  expect(taskIssue(value)).toBeUndefined();
});

it('keeps an uncertain send visible even when unrelated history refreshes', () => {
  const value = state();
  value.deliveries = { thread: { requestId: 'send', threadId: 'thread', phase: 'unknown' } };
  expect(taskStatus(value)?.label).toBe('发送结果待核实');
  expect(taskIssue(value)?.label).toBe('发送结果待核实');
  value.selected!.turns!.push({ id: 'unrelated', status: 'completed', items: [] });
  expect(taskStatus(value)?.label).toBe('发送结果待核实');
});

it('shows stale running and approval state as unverified while reconnecting', () => {
  const value = state();
  value.selected!.turns![0].status = 'inProgress';
  value.mode = 'connecting'; // v2 may keep ready=true while both data paths are recovering.
  value.approvals = [{ id: 1, method: 'item/commandExecution/requestApproval', params: { threadId: 'thread' } }];
  expect(taskStatus(value)?.label).toBe('任务状态待更新');
  expect(taskIssue(value)?.label).toBe('任务状态待更新');
  value.mode = 'direct';
  expect(taskStatus(value)?.label).toBe('等待你的确认');
  expect(taskIssue(value)).toBeUndefined();
});

it.each([
  [CONNECTION_ERRORS.expired, '需要重新登录'],
  [CONNECTION_ERRORS.unavailable, '暂时联系不到电脑'],
  [CONNECTION_ERRORS.network, '聊天服务暂时连不上'],
])('explains the connection issue %s', (connectionIssue, title) => {
  const health = connectionHealth({ ...initialChatState(), connectionIssue }, { online: true });
  expect(health.title).toBe(title);
  expect(health.next).not.toBe('');
  expect(health.reconnect).toBe(true);
});

it('uses the live path over stale presence and separates chat errors from connection failures', () => {
  const value = state(); value.error = '任务失败';
  const health = connectionHealth(value, { online: false });
  expect(health.title).toBe('已通过中转连接');
  expect(health.steps.every(step => step.status === 'ok')).toBe(true);
  value.ready = false; value.connectionIssue = CONNECTION_ERRORS.startup;
  expect(connectionHealth(value, { online: true }).title).toBe('正在恢复电脑上的聊天');
});
