import { expect, it } from 'vitest';
import { DEFAULT_CHAT_POLICY, P2P_POLICY_FIELDS, parseChatPolicy } from '../../../../shared/chat/chatPolicy';

it('accepts P2P settings above their defaults without a product upper limit', () => {
  for (const key of Object.keys(P2P_POLICY_FIELDS) as (keyof typeof P2P_POLICY_FIELDS)[]) {
    expect(P2P_POLICY_FIELDS[key].max).toBeUndefined();
    for (const seconds of [1, 1_000_000, Number.MAX_SAFE_INTEGER]) {
      expect(parseChatPolicy({ ...DEFAULT_CHAT_POLICY, [key]: seconds })[key]).toBe(seconds);
    }
  }
});

it('uses defaults for older policy messages that omit the P2P fields', () => {
  const legacy: Record<string, unknown> = { ...DEFAULT_CHAT_POLICY };
  for (const key of Object.keys(P2P_POLICY_FIELDS)) delete legacy[key];
  expect(parseChatPolicy(legacy)).toEqual(DEFAULT_CHAT_POLICY);
});

it('rejects invalid durations without rejecting other valid policy settings', () => {
  for (const key of Object.keys(P2P_POLICY_FIELDS)) {
    for (const value of [0, -1, 1.5, NaN, Infinity, '45', null]) {
      expect(() => parseChatPolicy({ ...DEFAULT_CHAT_POLICY, [key]: value })).toThrow();
    }
  }
});
