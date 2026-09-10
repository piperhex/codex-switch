import { beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  permission: vi.fn(), request: vi.fn(), schedule: vi.fn(), channel: vi.fn(), state: { currentState: 'active' },
}));
vi.mock('react-native', () => ({ AppState: mocks.state, Platform: { OS: 'android' } }));
vi.mock('expo-notifications', () => ({
  setNotificationHandler: vi.fn(), getPermissionsAsync: mocks.permission, requestPermissionsAsync: mocks.request,
  scheduleNotificationAsync: mocks.schedule, setNotificationChannelAsync: mocks.channel,
  AndroidImportance: { HIGH: 4 }, AndroidNotificationPriority: { HIGH: 'high' },
  AndroidNotificationVisibility: { PRIVATE: 0 }, IosAuthorizationStatus: { PROVISIONAL: 3 },
}));
const target = { kind: 'chat-completed' as const, account: 'a'.repeat(64),
  deviceId: 'computer', threadId: 'chat', turnId: 'turn' };
beforeEach(() => {
  vi.resetModules(); vi.clearAllMocks();
  mocks.state.currentState = 'active';
  mocks.permission.mockResolvedValue({ granted: true, canAskAgain: true });
  mocks.schedule.mockResolvedValue('notification');
  mocks.channel.mockResolvedValue({});
});

it('delivers one clickable notification for repeated completion events', async () => {
  const { notifyChatCompleted } = await import('./chatNotifications');
  await Promise.all([notifyChatCompleted(target, '工作计划', false), notifyChatCompleted(target, '工作计划', false)]);
  expect(mocks.schedule).toHaveBeenCalledOnce();
  expect(mocks.schedule).toHaveBeenCalledWith(expect.objectContaining({
    content: expect.objectContaining({ title: 'Codex 回复完成', body: '工作计划', data: target }),
    trigger: { channelId: 'chat-completed' },
  }));
});

it('does not ask for permission while backgrounded and does not post when denied', async () => {
  mocks.state.currentState = 'background';
  mocks.permission.mockResolvedValue({ granted: false, canAskAgain: true });
  const { prepareChatNotifications, notifyChatCompleted } = await import('./chatNotifications');
  expect(await prepareChatNotifications()).toBe(false);
  await notifyChatCompleted(target, '工作计划', false);
  expect(mocks.request).not.toHaveBeenCalled();
  expect(mocks.schedule).not.toHaveBeenCalled();
});

it('asks once in the foreground and allows retrying a failed notification delivery', async () => {
  mocks.permission.mockResolvedValue({ granted: false, canAskAgain: true });
  mocks.request.mockResolvedValue({ granted: false });
  const { prepareChatNotifications, notifyChatCompleted } = await import('./chatNotifications');
  await prepareChatNotifications(); await prepareChatNotifications();
  expect(mocks.request).toHaveBeenCalledOnce();
  mocks.permission.mockResolvedValue({ granted: true });
  mocks.schedule.mockRejectedValueOnce(new Error('unavailable'));
  await expect(notifyChatCompleted(target, '工作计划', true)).rejects.toThrow('unavailable');
  await notifyChatCompleted(target, '工作计划', true);
  expect(mocks.schedule).toHaveBeenCalledTimes(2);
  expect(mocks.schedule).toHaveBeenLastCalledWith(expect.objectContaining({
    content: expect.objectContaining({ title: 'Codex 回复未完成' }),
  }));
});
