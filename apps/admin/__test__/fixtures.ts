import type { UserEntity, UserRole } from '@/modules/user/entities/user.entity';
import type { SyncAccountDto } from '@/modules/sync/dto/sync-accounts.dto';
import type { SyncProviderDto } from '@/modules/sync/dto/sync-providers.dto';

export function makeUser(overrides: Partial<UserEntity> = {}): UserEntity {
  return {
    id: 'user-1',
    email: 'user@example.com',
    passwordHash: 'password-hash',
    role: 'user' as UserRole,
    disabled: false,
    refreshTokens: [],
    syncedAccounts: [],
    syncedProviders: [],
    syncedTotpVaults: [],
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

export function makeProvider(overrides: Partial<SyncProviderDto> = {}): SyncProviderDto {
  return {
    id: 'provider-1',
    kind: 'custom',
    name: 'Gateway',
    group: '',
    baseUrl: 'https://gateway.example.com/v1',
    apiKey: 'sk-provider-secret',
    model: 'gpt-4.1',
    models: ['gpt-4.1'],
    modelReasoningEfforts: { 'gpt-4.1': ['low', 'medium', 'high', 'xhigh'] },
    modelContextWindows: { 'gpt-4.1': 256_000 },
    imageInputModels: ['gpt-4.1'],
    contextWindow: 256_000,
    modelSelectionControlledByCodex: false,
    apiFormat: 'openaiResponses',
    lastModifiedAt: '2026-07-05T00:00:00.000Z',
    fieldModifiedAt: {
      kind: '2026-07-05T00:00:00.000Z',
      name: '2026-07-05T00:00:00.000Z',
      group: '2026-07-05T00:00:00.000Z',
      baseUrl: '2026-07-05T00:00:00.000Z',
      apiKey: '2026-07-05T00:00:00.000Z',
      model: '2026-07-05T00:00:00.000Z',
      models: '2026-07-05T00:00:00.000Z',
      modelReasoningEfforts: '2026-07-05T00:00:00.000Z',
      modelContextWindows: '2026-07-05T00:00:00.000Z',
      imageInputModels: '2026-07-05T00:00:00.000Z',
      contextWindow: '2026-07-05T00:00:00.000Z',
      modelSelectionControlledByCodex: '2026-07-05T00:00:00.000Z',
      apiFormat: '2026-07-05T00:00:00.000Z',
      balancePlatform: '2026-07-05T00:00:00.000Z',
      balanceQueryUrl: '2026-07-05T00:00:00.000Z',
      balanceQueryToken: '2026-07-05T00:00:00.000Z',
      walletQueryUrl: '2026-07-05T00:00:00.000Z',
      walletQueryToken: '2026-07-05T00:00:00.000Z',
      walletUsername: '2026-07-05T00:00:00.000Z',
      walletPassword: '2026-07-05T00:00:00.000Z',
    },
    ...overrides,
  };
}

export function makeAccount(overrides: Partial<SyncAccountDto> = {}): SyncAccountDto {
  return {
    id: 'account-1',
    email: 'account@example.com',
    note: 'primary',
    expiresAt: '2027-01-01',
    plan: 'Plus',
    accountId: 'codex-1',
    active: true,
    autoSwitchPriority: 0,
    usage: { used: 10 },
    lastModifiedAt: '2026-07-05T00:00:00.000Z',
    fieldModifiedAt: {
      auth: '2026-07-05T00:00:00.000Z',
      note: '2026-07-05T00:00:00.000Z',
      expiresAt: '2026-07-05T00:00:00.000Z',
      privateDetails: '2026-07-05T00:00:00.000Z',
      usage: '2026-07-05T00:00:00.000Z',
      active: '2026-07-05T00:00:00.000Z',
      autoSwitchPriority: '2026-07-05T00:00:00.000Z',
    },
    auth: { token: 'secret' },
    ...overrides,
  };
}
