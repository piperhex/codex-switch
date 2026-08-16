import { describe, expect, it } from 'vitest';
import { parseEmbeddedOAuthCallback } from './embeddedOAuth';

const CALLBACK_URL = 'http://localhost:1455/auth/callback';

describe('embedded OAuth callback parsing', () => {
  it('extracts authorization values from the exact local callback', () => {
    expect(parseEmbeddedOAuthCallback(
      `${CALLBACK_URL}?code=authorization-code&state=oauth-state`,
      CALLBACK_URL,
    )).toEqual({
      code: 'authorization-code',
      state: 'oauth-state',
      error: undefined,
    });
  });

  it('extracts a provider cancellation from the exact callback', () => {
    expect(parseEmbeddedOAuthCallback(
      `${CALLBACK_URL}?error=access_denied&state=oauth-state`,
      CALLBACK_URL,
    )).toEqual({
      code: undefined,
      state: 'oauth-state',
      error: 'access_denied',
    });
  });

  it('rejects lookalike origins and paths', () => {
    expect(parseEmbeddedOAuthCallback(
      'http://localhost.evil.example:1455/auth/callback?code=stolen',
      CALLBACK_URL,
    )).toBeNull();
    expect(parseEmbeddedOAuthCallback(
      'http://localhost:1455/auth/callback/extra?code=stolen',
      CALLBACK_URL,
    )).toBeNull();
  });
});
