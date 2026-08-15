import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import type { AuthSession } from '../types';
import { isTotpEntry } from './totp';
import type { TotpVault } from './types';

const VAULT_KEY_PREFIX = 'codex-switch.mobile.totp-vault.v1';
const SYNC_KEY_PREFIX = 'codex-switch.mobile.totp-cloud-sync.v1';
export const EMPTY_VAULT_MODIFIED_AT = '1970-01-01T00:00:00.000Z';

async function accountKey(session: AuthSession, prefix: string) {
  const identity = `${session.baseUrl}|${session.email.toLowerCase()}`;
  const digest = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, identity);
  return `${prefix}.${digest}`;
}

export async function loadTotpVault(session: AuthSession): Promise<TotpVault> {
  try {
    const raw = await SecureStore.getItemAsync(await accountKey(session, VAULT_KEY_PREFIX));
    if (!raw) return { entries: [], modifiedAt: EMPTY_VAULT_MODIFIED_AT };
    const stored: unknown = JSON.parse(raw);
    if (!stored || typeof stored !== 'object') throw new Error('invalid-vault');
    const candidate = stored as Partial<TotpVault>;
    const entries = Array.isArray(candidate.entries) ? candidate.entries.filter(isTotpEntry) : [];
    const modifiedAt = typeof candidate.modifiedAt === 'string'
      && !Number.isNaN(Date.parse(candidate.modifiedAt))
      ? candidate.modifiedAt
      : EMPTY_VAULT_MODIFIED_AT;
    return { entries, modifiedAt };
  } catch {
    return { entries: [], modifiedAt: EMPTY_VAULT_MODIFIED_AT };
  }
}

export async function saveTotpVault(session: AuthSession, vault: TotpVault) {
  await SecureStore.setItemAsync(
    await accountKey(session, VAULT_KEY_PREFIX),
    JSON.stringify(vault),
  );
}

export async function loadTotpCloudSyncEnabled(session: AuthSession) {
  try {
    const stored = await SecureStore.getItemAsync(await accountKey(session, SYNC_KEY_PREFIX));
    return stored === 'true';
  } catch {
    return false;
  }
}

export async function saveTotpCloudSyncEnabled(session: AuthSession, enabled: boolean) {
  await SecureStore.setItemAsync(await accountKey(session, SYNC_KEY_PREFIX), String(enabled));
}
