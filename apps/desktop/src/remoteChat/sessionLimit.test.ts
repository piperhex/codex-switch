import { expect, it } from 'vitest';
import { DEFAULT_CHAT_POLICY, parseChatPolicy } from '../../../../shared/chat/chatPolicy';

it('defaults older chat settings to five connections per computer', () => {
  const legacy: Record<string, unknown> = { ...DEFAULT_CHAT_POLICY };
  delete legacy.chatSessionLimit;
  expect(parseChatPolicy(legacy).chatSessionLimit).toBe(5);
});

it('accepts positive whole connection limits and rejects invalid values', () => {
  for (const limit of [1, 5, 12, Number.MAX_SAFE_INTEGER]) {
    expect(parseChatPolicy({ ...DEFAULT_CHAT_POLICY, chatSessionLimit: limit }).chatSessionLimit).toBe(limit);
  }
  for (const limit of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, '5', null]) {
    expect(() => parseChatPolicy({ ...DEFAULT_CHAT_POLICY, chatSessionLimit: limit })).toThrow();
  }
});
