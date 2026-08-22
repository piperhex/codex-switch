import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import {
  normalizePersonalAccountAuth,
  parsePersonalAccountImport,
} from '@/modules/sync/personal-account-import.service';

describe('personal account import parsing', () => {
  it('accepts single, array, wrapper, and line-delimited JSON', () => {
    expect(parsePersonalAccountImport('{"access_token":"one"}')).toHaveLength(1);
    expect(parsePersonalAccountImport('[{"access_token":"one"},{"access_token":"two"}]'))
      .toHaveLength(2);
    expect(parsePersonalAccountImport('{"accounts":[{"access_token":"one"}]}')).toHaveLength(1);
    expect(parsePersonalAccountImport('{"access_token":"one"}\n{"access_token":"two"}'))
      .toHaveLength(2);
  });

  it('normalizes common token aliases and nested JSON strings', () => {
    expect(normalizePersonalAccountAuth({
      session_json: JSON.stringify({
        accessToken: 'access',
        refreshToken: 'refresh',
        email: 'person@example.com',
      }),
    })).toMatchObject({
      tokens: {
        access_token: 'access',
        refresh_token: 'refresh',
        email: 'person@example.com',
      },
    });
  });

  it('normalizes compatible OpenAI credential exports', () => {
    expect(normalizePersonalAccountAuth({
      platform: 'openai',
      type: 'oauth',
      credentials: {
        access_token: 'access',
        refresh_token: 'refresh',
        chatgpt_account_id: 'account-id',
      },
    })).toMatchObject({
      tokens: {
        access_token: 'access',
        refresh_token: 'refresh',
        account_id: 'account-id',
      },
    });
  });

  it('rejects content without Codex credentials', () => {
    expect(() => normalizePersonalAccountAuth({ email: 'person@example.com' }))
      .toThrow(BadRequestException);
  });
});
