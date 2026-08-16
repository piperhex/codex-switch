import type { EmbeddedAccountOAuthCallback } from '../types';

export function parseEmbeddedOAuthCallback(
  url: string,
  callbackUrl: string,
): EmbeddedAccountOAuthCallback | null {
  try {
    const current = new URL(url);
    const expected = new URL(callbackUrl);
    if (current.origin !== expected.origin || current.pathname !== expected.pathname) return null;
    return {
      code: current.searchParams.get('code') ?? undefined,
      state: current.searchParams.get('state') ?? '',
      error: current.searchParams.get('error') ?? undefined,
    };
  } catch {
    return null;
  }
}
