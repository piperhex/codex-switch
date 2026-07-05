import type { UserEntity, UserRole } from '@/modules/user/entities/user.entity';
import type { SyncAccountDto } from '@/modules/sync/dto/sync-accounts.dto';

export function makeUser(overrides: Partial<UserEntity> = {}): UserEntity {
  return {
    id: 'user-1',
    email: 'user@example.com',
    passwordHash: 'password-hash',
    role: 'user' as UserRole,
    disabled: false,
    refreshTokens: [],
    syncedAccounts: [],
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
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
    usage: { used: 10 },
    lastModifiedAt: '2026-07-05T00:00:00.000Z',
    auth: { token: 'secret' },
    ...overrides,
  };
}
