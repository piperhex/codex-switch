import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { describe, expect, it } from 'vitest';
import { CreateAdminUserDto, UpdateAdminUserDto } from '@/modules/admin/dto/admin-user.dto';
import {
  CreateApprovalRequestDto,
  ChangeSystemAccountBindingsDto,
  CreateSystemAccountDto,
  ImportSystemAccountsDto,
  ListSystemAccountsQueryDto,
  CreateInvitationDto,
  ReviewApprovalRequestDto,
  UpdateAdminSyncedAccountDto,
  UpdateOwnSyncedAccountDto,
} from '@/modules/admin/dto/admin-management.dto';
import { LoginDto } from '@/modules/auth/dto/login.dto';
import { UpdateAnnouncementDto } from '@/modules/announcement/dto/update-announcement.dto';
import {
  CreateAnnouncementClickDto,
  ListAnnouncementClicksQueryDto,
} from '@/modules/announcement/dto/announcement-click.dto';
import { RefreshDto } from '@/modules/auth/dto/refresh.dto';
import { RegisterDto } from '@/modules/auth/dto/register.dto';
import { RequestPasswordResetCodeDto } from '@/modules/auth/dto/request-password-reset-code.dto';
import { ResetPasswordDto } from '@/modules/auth/dto/reset-password.dto';
import { PutSyncAccountsDto, SyncAccountDto } from '@/modules/sync/dto/sync-accounts.dto';
import { CompleteAccountOAuthDto } from '@/modules/sync/dto/complete-account-oauth.dto';
import { PutSyncProvidersDto, SyncProviderDto } from '@/modules/sync/dto/sync-providers.dto';
import {
  PutSyncTotpVaultDto,
  TotpEntryDto,
  TotpTombstoneDto,
} from '@/modules/sync/dto/sync-totp.dto';
import {
  ListDeviceInstallationsQueryDto,
  ListTelemetryEventsQueryDto,
} from '@/modules/telemetry/dto/list-telemetry.dto';
import { CreateInstallationEventDto } from '@/modules/telemetry/dto/create-installation-event.dto';
import { makeAccount, makeProvider } from './fixtures';

async function messages<T extends object>(type: new () => T, value: object) {
  const errors = await validate(plainToInstance(type, value));
  return errors.flatMap((error) => Object.values(error.constraints ?? {}));
}

describe('request DTO validation', () => {
  it('validates separate official-account filters', async () => {
    await expect(messages(ListSystemAccountsQueryDto, {
      email: 'pool@example.com',
      plan: 'plus',
      note: 'shared',
      addedByEmail: 'operator@example.com',
      boundUserCount: '2',
    })).resolves.toEqual([]);
    await expect(messages(ListSystemAccountsQueryDto, {
      email: 'x'.repeat(241),
      boundUserCount: '-1',
    })).resolves.toEqual(expect.arrayContaining([
      'email must be shorter than or equal to 240 characters',
      'boundUserCount must not be less than 0',
    ]));
  });

  it('enforces authentication email, password and token contracts', async () => {
    await expect(messages(RegisterDto, { email: 'bad', password: 'short', verificationCode: '12ab' }))
      .resolves.toEqual(expect.arrayContaining([
        'email must be an email', 'password must be longer than or equal to 8 characters',
        'verificationCode must be a 6-digit number',
      ]));
    await expect(messages(LoginDto, { email: 'valid@example.com', password: '12345' }))
      .resolves.toContain('password must be longer than or equal to 6 characters');
    await expect(messages(RefreshDto, { refreshToken: 123 })).resolves.toContain('refreshToken must be a string');
    await expect(messages(RegisterDto, {
      email: 'valid@example.com', password: '12345678', verificationCode: '123456',
    }))
      .resolves.toEqual([]);
    await expect(messages(RequestPasswordResetCodeDto, { email: 'bad' }))
      .resolves.toContain('email must be an email');
    await expect(messages(ResetPasswordDto, {
      email: 'valid@example.com', verificationCode: '12ab', newPassword: 'short',
    })).resolves.toEqual(expect.arrayContaining([
      'verificationCode must be a 6-digit number',
      'newPassword must be longer than or equal to 8 characters',
    ]));
    await expect(messages(CompleteAccountOAuthDto, {
      code: 'authorization-code', state: 'oauth-state',
    })).resolves.toEqual([]);
    await expect(messages(CompleteAccountOAuthDto, {
      code: 'authorization-code',
    })).resolves.toContain('state must be a string');
  });

  it('accepts dynamic role codes while rejecting malformed codes and patch types', async () => {
    await expect(messages(CreateAdminUserDto, {
      email: 'admin@example.com', password: '1234567', role: 'SuperUser',
    })).resolves.toEqual(expect.arrayContaining([
      'password must be longer than or equal to 8 characters',
      'role must match /^[a-z][a-z0-9_-]{1,63}$/ regular expression',
    ]));
    await expect(messages(UpdateAdminUserDto, { disabled: 'yes', role: 'bad role' }))
      .resolves.toEqual(expect.arrayContaining([
        'disabled must be a boolean value',
        'role must match /^[a-z][a-z0-9_-]{1,63}$/ regular expression',
      ]));
    await expect(messages(UpdateAdminUserDto, { email: 'bad', password: 'short' }))
      .resolves.toEqual(expect.arrayContaining([
        'email must be an email',
        'password must be longer than or equal to 8 characters',
      ]));
    await expect(messages(CreateAdminUserDto, {
      email: 'admin@example.com', password: 'password', role: 'support_manager', disabled: false,
    })).resolves.toEqual([]);
    await expect(messages(UpdateAdminUserDto, {})).resolves.toEqual([]);
  });

  it('validates management invitations, approvals and admin account edits', async () => {
    await expect(messages(CreateInvitationDto, {
      email: 'bad', role: 'Bad Role', expiresInHours: 0, maxUses: 0, neverExpires: 'yes',
    })).resolves.toEqual(expect.arrayContaining([
      'email must be an email',
      'role must match /^[a-z][a-z0-9_-]{1,63}$/ regular expression',
      'expiresInHours must not be less than 1',
      'maxUses must not be less than 1',
      'neverExpires must be a boolean value',
    ]));
    await expect(messages(CreateInvitationDto, {
      role: 'user', maxUses: 5, neverExpires: true,
    })).resolves.toEqual([]);
    await expect(messages(CreateApprovalRequestDto, {
      type: 'delete_everything', targetUserId: 123,
    })).resolves.toEqual(expect.arrayContaining([
      'type must be one of the following values: promote_user_to_admin',
      'targetUserId must be a string',
    ]));
    await expect(messages(ReviewApprovalRequestDto, { decision: 'maybe' }))
      .resolves.toContain('decision must be one of the following values: approved, rejected');
    await expect(messages(UpdateAdminSyncedAccountDto, {
      email: 'x'.repeat(241), active: 'yes', usage: 'none',
    })).resolves.toEqual(expect.arrayContaining([
      'email must be shorter than or equal to 240 characters',
      'active must be a boolean value',
      'usage must be an object',
    ]));
    await expect(messages(UpdateOwnSyncedAccountDto, {
      note: 'x'.repeat(1001), expiresAt: 'x'.repeat(41),
    })).resolves.toEqual(expect.arrayContaining([
      'note must be shorter than or equal to 1000 characters',
      'expiresAt must be shorter than or equal to 40 characters',
    ]));
  });

  it('restricts announcement scroll duration to whole seconds from 5 through 120', async () => {
    const validAnnouncement = {
      contentZh: '计划维护',
      contentEn: 'Scheduled maintenance',
      link: '',
      enabled: true,
      textColor: '#FFFFFF',
      backgroundColor: '#000000',
      scrollDurationSeconds: 22,
    };
    await expect(messages(UpdateAnnouncementDto, validAnnouncement)).resolves.toEqual([]);
    await expect(messages(UpdateAnnouncementDto, {
      ...validAnnouncement,
      link: 'https://status.example.com/notices/maintenance',
    })).resolves.toEqual([]);
    await expect(messages(UpdateAnnouncementDto, {
      ...validAnnouncement,
      link: 'javascript:alert(1)',
    })).resolves.toContain('link must be a URL address');
    await expect(messages(UpdateAnnouncementDto, {
      ...validAnnouncement,
      scrollDurationSeconds: 4,
    })).resolves.toContain('scrollDurationSeconds must not be less than 5');
    await expect(messages(UpdateAnnouncementDto, {
      ...validAnnouncement,
      scrollDurationSeconds: 120.5,
    })).resolves.toContain('scrollDurationSeconds must be an integer number');
  });

  it('validates announcement click device, platform, link and paging fields', async () => {
    await expect(messages(CreateAnnouncementClickDto, {
      deviceId: '18f72fe6-1ec1-4d68-b5c1-f1b52b67503f',
      platform: 'windows',
      link: 'https://status.example.com/notice',
      announcementUpdatedAt: '2026-07-18T01:00:00.000Z',
    })).resolves.toEqual([]);
    await expect(messages(CreateAnnouncementClickDto, {
      deviceId: 'not-a-device-id',
      platform: 'web',
      link: 'javascript:alert(1)',
      announcementUpdatedAt: 'yesterday',
    })).resolves.toEqual(expect.arrayContaining([
      'deviceId must be a UUID',
      'platform must be one of the following values: windows, macos, linux, android, ios',
      'link must be a URL address',
      'announcementUpdatedAt must be a valid ISO 8601 date string',
    ]));
    await expect(messages(ListAnnouncementClicksQueryDto, {
      page: '2',
      pageSize: '50',
      search: 'user@example.com',
      platform: 'macos',
    })).resolves.toEqual([]);
  });

  it('validates nested sync accounts and accepts a complete valid payload', async () => {
    const valid = plainToInstance(PutSyncAccountsDto, { accounts: [makeAccount({
      privateDetails: {
        password: 'saved-password',
        phoneNumber: '+65 6123 4567',
        totpSecret: 'JBSWY3DPEHPK3PXP',
      },
      autoSwitchThreshold: 37.5,
    })] });
    expect(valid.accounts[0]).toBeInstanceOf(SyncAccountDto);
    await expect(validate(valid)).resolves.toEqual([]);

    const invalid = plainToInstance(PutSyncAccountsDto, {
      accounts: [{
        ...makeAccount(),
        id: 'x'.repeat(65),
        active: 'yes',
        autoSwitchPriority: 1.5,
        autoSwitchThreshold: 101,
        usage: 'none',
        privateDetails: { password: '', phoneNumber: '', totpSecret: 'not-base32' },
      }],
    });
    const errors = await validate(invalid);
    expect(errors).toHaveLength(1);
    expect(errors[0].property).toBe('accounts');
    expect(errors[0].children?.[0].children?.map((error) => error.property))
      .toEqual(expect.arrayContaining([
        'id',
        'active',
        'autoSwitchPriority',
        'autoSwitchThreshold',
        'usage',
        'privateDetails',
      ]));
  });

  it('validates versioned 2FA entries and remains compatible with legacy snapshots', async () => {
    const entry = {
      id: '10000000-0000-4000-8000-000000000001',
      issuer: 'Example',
      accountName: 'person@example.com',
      secret: 'JBSWY3DPEHPK3PXP',
      algorithm: 'SHA1',
      digits: 6,
      period: 30,
      createdAt: '2026-08-15T09:00:00.000Z',
      updatedAt: '2026-08-15T10:00:00.000Z',
    };
    const versioned = plainToInstance(PutSyncTotpVaultDto, {
      entries: [entry],
      tombstones: [{ id: entry.id, deletedAt: '2026-08-15T10:00:01.000Z' }],
      modifiedAt: '2026-08-15T10:00:01.000Z',
    });
    expect(versioned.entries[0]).toBeInstanceOf(TotpEntryDto);
    expect(versioned.tombstones?.[0]).toBeInstanceOf(TotpTombstoneDto);
    await expect(validate(versioned)).resolves.toEqual([]);

    const legacy = plainToInstance(PutSyncTotpVaultDto, {
      entries: [{ ...entry, updatedAt: undefined }],
      modifiedAt: '2026-08-15T10:00:00.000Z',
    });
    await expect(validate(legacy)).resolves.toEqual([]);
  });

  it('applies sync DTO defaults while allowing a nullable provider account id', async () => {
    const value = plainToInstance(SyncAccountDto, {
      id: 'account-1', email: 'a@example.com', plan: 'Plus', accountId: null,
      active: false, usage: {}, auth: {},
    });
    expect(value.note).toBe('');
    expect(value.expiresAt).toBe('');
    await expect(validate(value)).resolves.toEqual([]);
  });

  it('validates official account credentials and bulk binding identifiers', async () => {
    await expect(messages(CreateSystemAccountDto, {
      auth: 'not-an-object',
      note: 'x'.repeat(1001),
    })).resolves.toEqual(expect.arrayContaining([
      'auth must be an object',
      'note must be shorter than or equal to 1000 characters',
    ]));
    await expect(messages(ChangeSystemAccountBindingsDto, {
      systemAccountIds: [],
      userIds: ['not-a-uuid'],
    })).resolves.toEqual(expect.arrayContaining([
      'systemAccountIds should not be empty',
      'each value in userIds must be a UUID',
    ]));
    await expect(messages(ChangeSystemAccountBindingsDto, {
      systemAccountIds: ['10000000-0000-4000-8000-000000000001'],
      userIds: ['20000000-0000-4000-8000-000000000001'],
    })).resolves.toEqual([]);
  });

  it('validates telemetry paging and supported filters', async () => {
    await expect(messages(ListDeviceInstallationsQueryDto, {
      page: 0,
      pageSize: 101,
      platform: 'web',
      search: 'x'.repeat(37),
    })).resolves.toEqual(expect.arrayContaining([
      'page must not be less than 1',
      'pageSize must not be greater than 100',
      'platform must be one of the following values: windows, macos, linux, android, ios',
      'search must be shorter than or equal to 36 characters',
    ]));
    await expect(messages(CreateInstallationEventDto, {
      deviceId: '18f72fe6-1ec1-4d68-b5c1-f1b52b67503f',
      platform: 'android',
      appVersion: '0.1.0',
      eventType: 'installation',
    })).resolves.toEqual([]);
    await expect(messages(ListTelemetryEventsQueryDto, {
      page: '2',
      pageSize: '50',
      platform: 'linux',
      eventType: 'base_url_changed',
    })).resolves.toEqual([]);
    await expect(messages(ImportSystemAccountsDto, {
      content: '',
      note: 'x'.repeat(1001),
    })).resolves.toEqual(expect.arrayContaining([
      'content should not be empty',
      'note must be shorter than or equal to 1000 characters',
    ]));
    await expect(messages(ImportSystemAccountsDto, {
      content: '{"tokens":{"access_token":"token"}}',
      expiresAt: '2026-07-18T12:00:00.000Z',
    })).resolves.toEqual([]);
  });

  it('validates nested sync providers and accepts complete provider payloads', async () => {
    const valid = plainToInstance(PutSyncProvidersDto, { providers: [makeProvider()] });
    expect(valid.providers[0]).toBeInstanceOf(SyncProviderDto);
    await expect(validate(valid)).resolves.toEqual([]);

    const invalid = plainToInstance(PutSyncProvidersDto, {
      providers: [{
        ...makeProvider(),
        apiFormat: 'unsupported',
        models: ['ok', 123],
        contextWindow: 0,
        modelSelectionControlledByCodex: 'yes',
      }],
    });
    const errors = await validate(invalid);
    expect(errors).toHaveLength(1);
    expect(errors[0].property).toBe('providers');
    expect(errors[0].children?.[0].children?.map((error) => error.property))
      .toEqual(expect.arrayContaining([
        'models', 'contextWindow', 'modelSelectionControlledByCodex', 'apiFormat',
      ]));
  });

  it('applies provider DTO defaults', async () => {
    const value = plainToInstance(SyncProviderDto, {
      id: 'provider-1',
      name: 'Gateway',
      baseUrl: 'https://gateway.example.com/v1',
      apiKey: 'sk-secret',
      model: 'gpt-4.1',
      apiFormat: 'openaiResponses',
    });
    expect(value.models).toEqual([]);
    expect(value.modelSelectionControlledByCodex).toBe(false);
    await expect(validate(value)).resolves.toEqual([]);
  });
});
