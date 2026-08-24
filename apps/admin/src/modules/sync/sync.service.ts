import { createHash, randomUUID } from 'crypto';
import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import Redis from 'ioredis';
import { DataSource, In, IsNull, Not, Repository } from 'typeorm';
import type { SelectQueryBuilder } from 'typeorm';
import { MODULE_OPTIONS_TOKEN } from '@/config/configurable';
import type { ConfigModuleOptions } from '@/config/config.types';
import { REDIS_CLIENT } from '@/modules/redis/redis.constants';
import {
  PutSyncAccountsDto,
  SyncAccountDto,
  type UpdateAccountDetailsDto,
} from './dto/sync-accounts.dto';
import { PutSyncProvidersDto, SyncProviderDto } from './dto/sync-providers.dto';
import { PutSyncTotpVaultDto } from './dto/sync-totp.dto';
import { SyncedAccountEntity } from './entities/synced-account.entity';
import { SyncedProviderEntity } from './entities/synced-provider.entity';
import { SyncedTotpVaultEntity } from './entities/synced-totp-vault.entity';
import { SystemAccountBindingEntity } from './entities/system-account-binding.entity';
import { SystemAccountEntity } from './entities/system-account.entity';
import { RemoteDeviceEntity } from '@/modules/devices/entities/remote-device.entity';
import { mergeTotpVault, readStoredTotpVault } from './totp-vault-merge';
import {
  createCodexOutboundDispatcher,
  withCodexOutboundDispatcher,
} from './codex-outbound-proxy';

const DEVICE_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CODEX_ORIGINATOR = 'codex_cli_rs';
const CODEX_USAGE_URL = 'https://chatgpt.com/backend-api/wham/usage';
const RESET_CREDITS_URL = 'https://chatgpt.com/backend-api/wham/rate-limit-reset-credits';
const RESET_CREDIT_CONSUME_URL =
  'https://chatgpt.com/backend-api/wham/rate-limit-reset-credits/consume';
const OPENAI_TOKEN_URL = 'https://auth.openai.com/oauth/token';
const OPENAI_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';

export interface ResetCreditDto {
  issuedAt?: string | null;
  expiresAt?: string | null;
}

export interface ResetCreditsSummaryDto {
  credits: ResetCreditDto[];
}

export interface UsageWindowDto {
  usedPercent: number;
  remainingPercent: number;
  resetsAt?: number | null;
  windowMinutes?: number | null;
}

export interface UsageSummaryDto {
  primary?: UsageWindowDto | null;
  secondary?: UsageWindowDto | null;
  apiExpiresAt?: string | null;
  plan?: string | null;
  fetchedAt: string;
  error: null;
}

type StoredResetCreditAccount =
  | { source: 'personal'; account: SyncedAccountEntity }
  | { source: 'system'; account: SystemAccountEntity };

export type AdminSyncAccountDto = Omit<SyncAccountDto, 'privateDetails'> & {
  source: 'personal' | 'system';
  systemAccountId?: string;
  inSystemPool?: boolean;
};

export type PortalSyncAccountDto = Omit<AdminSyncAccountDto, 'auth'>;

export interface DeletedSyncAccountDto {
  id: string;
  email: string;
  note: string;
  expiresAt: string;
  plan: string;
  deletedAt: string;
}

export interface DeletedSyncProviderDto {
  id: string;
  name: string;
  baseUrl: string;
  model: string;
  deletedAt: string;
}

type EffectiveSyncAccountDto = SyncAccountDto & {
  official: boolean;
  metadataEditable: boolean;
};

export type MobileSyncAccountDto = Omit<EffectiveSyncAccountDto, 'auth'> & {
  codexAccessToken?: string;
};

type AccountFieldModifiedAt = {
  auth: string;
  note: string;
  expiresAt: string;
  privateDetails: string;
  usage: string;
  active: string;
  autoSwitchPriority: string;
  autoSwitchThreshold: string;
};

interface AccountMergeResult {
  account: Partial<SyncedAccountEntity>;
  activeApplied: boolean;
}

type ProviderFieldModifiedAt = {
  kind: string;
  name: string;
  group: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  models: string;
  modelReasoningEfforts: string;
  modelContextWindows: string;
  modelApiFormats: string;
  imageInputModels: string;
  contextWindow: string;
  modelSelectionControlledByCodex: string;
  apiFormat: string;
  balancePlatform: string;
  balanceQueryUrl: string;
  balanceQueryToken: string;
  walletQueryUrl: string;
  walletQueryToken: string;
  walletUsername: string;
  walletPassword: string;
};

const PROVIDER_REASONING_EFFORTS = new Set([
  'none', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra',
]);
const PROVIDER_API_FORMATS = new Set(['openaiResponses', 'openaiChat']);

export interface SystemAccountDto {
  id: string;
  syncAccountId: string;
  email: string;
  note: string;
  expiresAt: string;
  plan: string;
  accountId?: string | null;
  usage: Record<string, unknown>;
  lastModifiedAt: string;
  boundUserCount: number;
  source: 'admin' | 'desktop';
  addedByUserId?: string | null;
  addedByEmail?: string | null;
  sourceAccountId?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface SystemAccountInput {
  auth: Record<string, unknown>;
  note?: string;
  expiresAt?: string;
  usage?: Record<string, unknown>;
}

export interface SystemAccountOrigin {
  source: 'admin' | 'desktop';
  addedByUserId: string;
  addedByEmail: string;
  sourceAccountId?: string;
}

export interface SystemAccountListFilters {
  /** Former combined search, retained for backward compatibility. */
  search?: string;
  email?: string;
  plan?: string;
  note?: string;
  addedByEmail?: string;
  boundUserCount?: number;
}

export interface SystemAccountPatch {
  auth?: Record<string, unknown>;
  note?: string;
  expiresAt?: string;
  usage?: Record<string, unknown>;
}

export interface CreatedSystemAccountBinding {
  systemAccountId: string;
  systemAccountEmail: string;
  userId: string;
}

@Injectable()
export class SyncService {
  private readonly codexOutboundDispatcher: ReturnType<typeof createCodexOutboundDispatcher>;

  constructor(
    @InjectRepository(SyncedAccountEntity)
    private readonly accounts: Repository<SyncedAccountEntity>,
    @InjectRepository(SyncedProviderEntity)
    private readonly providers: Repository<SyncedProviderEntity>,
    @InjectRepository(SyncedTotpVaultEntity)
    private readonly totpVaults: Repository<SyncedTotpVaultEntity>,
    @InjectRepository(SystemAccountEntity)
    private readonly systemAccounts: Repository<SystemAccountEntity>,
    @InjectRepository(SystemAccountBindingEntity)
    private readonly systemBindings: Repository<SystemAccountBindingEntity>,
    @InjectRepository(RemoteDeviceEntity)
    private readonly remoteDevices: Repository<RemoteDeviceEntity>,
    private readonly dataSource: DataSource,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    @Inject(MODULE_OPTIONS_TOKEN) config: ConfigModuleOptions,
  ) {
    this.codexOutboundDispatcher = createCodexOutboundDispatcher(config.CODEX_OUTBOUND_PROXY);
  }

  async list(ownerId: string, deviceId?: string, canEditOfficialMetadata = false) {
    const cacheKey = this.cacheKey(ownerId);
    const cached = await this.redis.get(cacheKey);
    if (cached) {
      const parsed = JSON.parse(cached) as {
        accounts: EffectiveSyncAccountDto[];
        deletedAccountIds?: string[];
      };
      const projected = await this.withDeviceActiveAccount(
        ownerId,
        deviceId,
        { ...parsed, deletedAccountIds: parsed.deletedAccountIds ?? [] },
      );
      return this.withOfficialMetadataAccess(projected, canEditOfficialMetadata);
    }

    const payload = await this.loadEffectiveAccountState(ownerId);
    await this.redis.set(cacheKey, JSON.stringify(payload), 'EX', 60);
    return this.withOfficialMetadataAccess(
      await this.withDeviceActiveAccount(ownerId, deviceId, payload),
      canEditOfficialMetadata,
    );
  }

  async replace(
    ownerId: string,
    dto: PutSyncAccountsDto,
    deviceId?: string,
    canEditOfficialMetadata = false,
  ) {
    const managedIds = await this.boundSystemSyncIds(ownerId);
    for (const account of dto.accounts) {
      if (!managedIds.has(account.id)) continue;
      await this.updateBoundSystemAccountMetadata(
        ownerId,
        account,
        canEditOfficialMetadata,
        false,
      );
      await this.upsertBoundAccountPrivateDetails(ownerId, account);
    }
    await this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(SyncedAccountEntity);
      if (!dto.accounts.length) return;
      for (const account of dto.accounts) {
        if (managedIds.has(account.id)) continue;
        const existing = await repo.findOne({ where: { ownerId, accountId: account.id } });
        const merged = this.mergeIncomingAccount(existing, ownerId, account);
        if (!merged) continue;
        if (merged.activeApplied && merged.account.active) {
          await repo.update({ ownerId }, { active: false });
        }
        await repo.save(repo.create(merged.account));
      }
    });
    await this.redis.del(this.cacheKey(ownerId));
    await this.updateDeviceActiveAccount(ownerId, deviceId, dto.accounts);
    return { count: dto.accounts.length };
  }

  async upsert(
    ownerId: string,
    accountId: string,
    account: SyncAccountDto,
    deviceId?: string,
    canEditOfficialMetadata = false,
  ) {
    if (account.id !== accountId) {
      throw new BadRequestException('Route account id does not match request body');
    }
    if (await this.isSystemAccountBound(ownerId, accountId)) {
      await this.updateBoundSystemAccountMetadata(
        ownerId,
        account,
        canEditOfficialMetadata,
        true,
      );
      await this.upsertBoundAccountPrivateDetails(ownerId, account);
      await this.redis.del(this.cacheKey(ownerId));
      await this.updateDeviceActiveAccount(ownerId, deviceId, [account]);
      return { id: accountId };
    }
    await this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(SyncedAccountEntity);
      const existing = await repo.findOne({ where: { ownerId, accountId } });
      const merged = this.mergeIncomingAccount(existing, ownerId, account);
      if (!merged) return;
      if (merged.activeApplied && merged.account.active) {
        await repo.update({ ownerId }, { active: false });
      }
      await repo.save(repo.create(merged.account));
    });
    await this.redis.del(this.cacheKey(ownerId));
    await this.updateDeviceActiveAccount(ownerId, deviceId, [account]);
    return { id: accountId };
  }

  async delete(ownerId: string, accountId: string) {
    const bindings = await this.loadSystemBindings(ownerId);
    const binding = bindings.find((item) => item.account.syncAccountId === accountId);
    const deletedAt = new Date();
    if (binding) {
      await this.markAccountDeleted(ownerId, accountId, deletedAt, binding.account);
      await this.systemBindings.delete({
        systemAccountId: binding.systemAccountId,
        userId: ownerId,
      });
      await this.redis.del(this.cacheKey(ownerId));
      return { id: accountId };
    }
    await this.accounts.update({ ownerId, accountId }, { active: false, deletedAt });
    await this.redis.del(this.cacheKey(ownerId));
    return { id: accountId };
  }

  async listDeletedAccounts(ownerId: string): Promise<{ accounts: DeletedSyncAccountDto[] }> {
    const rows = await this.accounts.find({
      where: { ownerId, deletedAt: Not(IsNull()) },
      order: { deletedAt: 'DESC' },
    });
    return {
      accounts: rows.map((row) => ({
        id: row.accountId,
        email: row.email,
        note: row.note,
        expiresAt: row.expiresAt,
        plan: row.plan,
        deletedAt: row.deletedAt!.toISOString(),
      })),
    };
  }

  async restoreDeletedAccount(ownerId: string, accountId: string) {
    const account = await this.accounts.findOne({
      where: { ownerId, accountId, deletedAt: Not(IsNull()) },
    });
    if (!account) throw new NotFoundException('Deleted account not found');
    account.deletedAt = null;
    account.active = false;
    const saved = await this.accounts.save(account);
    await this.redis.del(this.cacheKey(ownerId));
    return this.toDto(saved);
  }

  async listProviders(ownerId: string) {
    const cacheKey = this.providerCacheKey(ownerId);
    const cached = await this.redis.get(cacheKey);
    if (cached) {
      const parsed = JSON.parse(cached) as {
        providers: SyncProviderDto[];
        deletedProviderIds?: string[];
      };
      return { ...parsed, deletedProviderIds: parsed.deletedProviderIds ?? [] };
    }

    const rows = await this.providers.find({
      where: { ownerId },
      order: { name: 'ASC' },
    });
    const payload = {
      providers: rows.filter((row) => !row.deletedAt).map((row) => this.toProviderDto(row)),
      deletedProviderIds: rows.filter((row) => Boolean(row.deletedAt)).map((row) => row.providerId),
    };
    await this.redis.set(cacheKey, JSON.stringify(payload), 'EX', 60);
    return payload;
  }

  async listSummary(ownerId: string, canEditOfficialMetadata = false) {
    const effective = this.withOfficialMetadataAccess(
      await this.loadEffectiveAccountState(ownerId),
      canEditOfficialMetadata,
    );
    return {
      accounts: effective.accounts
        .map((account) => this.mobileAccountSummary(account)),
    };
  }

  async upsertPersonalAccountFromAuth(
    ownerId: string,
    rawAuth: Record<string, unknown>,
  ): Promise<MobileSyncAccountDto> {
    const auth = this.normalizeSystemAccountAuth(rawAuth);
    const identity = this.systemAccountIdentity(auth);
    const effective = (await this.loadEffectiveAccountState(ownerId)).accounts
      .find((account) => account.id === identity.syncAccountId);
    const modifiedAt = this.formatLastModifiedAt(new Date());
    const fieldModifiedAt = this.normalizeAccountFieldModifiedAt(
      effective?.fieldModifiedAt,
      effective?.lastModifiedAt ?? modifiedAt,
    );
    fieldModifiedAt.auth = modifiedAt;
    await this.upsert(ownerId, identity.syncAccountId, {
      id: identity.syncAccountId,
      email: identity.email,
      note: effective?.note ?? '',
      expiresAt: effective?.expiresAt ?? '',
      privateDetails: effective?.privateDetails,
      plan: identity.plan,
      accountId: identity.codexAccountId,
      active: effective?.active ?? false,
      autoSwitchPriority: effective?.autoSwitchPriority ?? 0,
      autoSwitchThreshold: effective?.autoSwitchThreshold ?? 0,
      usage: effective?.usage ?? {},
      auth,
      fieldModifiedAt,
      lastModifiedAt: modifiedAt,
    });
    return this.mobileAccountById(ownerId, identity.syncAccountId);
  }

  async accountDetails(ownerId: string, accountId: string) {
    const account = (await this.loadEffectiveAccountState(ownerId)).accounts
      .find((candidate) => candidate.id === accountId);
    if (!account) throw new NotFoundException('Synced account not found');
    const { codexAccessToken: _token, official, ...details } = this.mobileAccountSummary(account);
    return { ...details, source: official ? 'system' : 'personal' };
  }
  async updateAccountDetails(
    ownerId: string,
    accountId: string,
    details: UpdateAccountDetailsDto,
    canEditOfficialMetadata = false,
  ): Promise<MobileSyncAccountDto> {
    const account = (await this.loadEffectiveAccountState(ownerId)).accounts
      .find((candidate) => candidate.id === accountId);
    if (!account) throw new NotFoundException('Synced account not found');
    const modifiedAt = this.formatLastModifiedAt(new Date());
    const fieldModifiedAt = this.normalizeAccountFieldModifiedAt(
      account.fieldModifiedAt,
      account.lastModifiedAt,
    );
    fieldModifiedAt.note = modifiedAt;
    fieldModifiedAt.expiresAt = modifiedAt;
    fieldModifiedAt.privateDetails = modifiedAt;
    await this.upsert(ownerId, accountId, {
      ...account,
      note: details.note,
      expiresAt: details.expiresAt,
      privateDetails: details.privateDetails,
      fieldModifiedAt,
      lastModifiedAt: modifiedAt,
    }, undefined, canEditOfficialMetadata);
    return this.mobileAccountById(ownerId, accountId);
  }

  async listWebSummary(ownerId: string) {
    return {
      accounts: (await this.loadEffectiveAccountState(ownerId)).accounts.map((row) => {
        const {
          auth: _auth,
          privateDetails: _privateDetails,
          official,
          metadataEditable: _metadataEditable,
          ...account
        } = row;
        return { ...account, source: official ? 'system' : 'personal' };
      }),
    };
  }

  async fetchUsage(ownerId: string, accountId: string): Promise<UsageSummaryDto> {
    const account = await this.resolveResetCreditAccount(ownerId, accountId);
    const response = await this.codexAccountRequest(ownerId, account, CODEX_USAGE_URL);
    if (!response.ok) {
      throw new BadGatewayException(`Codex 用量接口返回 HTTP ${response.status}`);
    }
    const payload = await this.responseObject(response, '解析 Codex 用量响应失败');
    const rateLimit = this.objectValue(payload.rate_limit);
    return {
      primary: this.usageWindow(rateLimit?.primary_window),
      secondary: this.usageWindow(rateLimit?.secondary_window),
      apiExpiresAt: this.promoExpiration(payload.promo),
      plan: this.stringValue(payload.plan_type)?.trim() || null,
      fetchedAt: new Date().toISOString(),
      error: null,
    };
  }

  async fetchResetCredits(ownerId: string, accountId: string): Promise<ResetCreditsSummaryDto> {
    const account = await this.resolveResetCreditAccount(ownerId, accountId);
    return this.fetchResetCreditsForAccount(ownerId, account);
  }

  async consumeResetCredit(ownerId: string, accountId: string) {
    const account = await this.resolveResetCreditAccount(ownerId, accountId);
    const credits = await this.fetchResetCreditsForAccount(ownerId, account);
    if (!credits.credits.length) {
      throw new BadRequestException('当前账号没有可用重置卡');
    }

    const response = await this.codexAccountRequest(
      ownerId,
      account,
      RESET_CREDIT_CONSUME_URL,
      {
        method: 'POST',
        body: JSON.stringify({
          redeem_request_id: `codex-switch-${Date.now()}-${randomUUID()}`,
        }),
      },
    );
    if (!response.ok) {
      throw new BadGatewayException(`Codex 重置卡使用接口返回 HTTP ${response.status}`);
    }

    const payload = await this.responseObject(response, '解析重置卡使用响应失败');
    const code = this.stringValue(payload.code);
    if (code === 'reset' || code === 'already_redeemed') return { ok: true };
    if (code === 'no_credit') throw new BadRequestException('当前账号没有可用重置卡');
    if (code === 'nothing_to_reset') {
      throw new BadRequestException('当前账号当前没有需要重置的用量窗口');
    }
    if (code) {
      throw new BadGatewayException(`Codex 重置卡使用接口返回未知状态：${code}`);
    }
    throw new BadGatewayException('Codex 重置卡使用接口响应缺少 code');
  }

  async listForAdmin(ownerId: string): Promise<{ accounts: AdminSyncAccountDto[] }> {
    const [personalRows, bindings] = await Promise.all([
      this.accounts.find({ where: { ownerId, deletedAt: IsNull() }, order: { email: 'ASC' } }),
      this.loadSystemBindings(ownerId),
    ]);
    const pooledPersonalAccounts = personalRows.length
      ? await this.systemAccounts.find({
        where: { syncAccountId: In(personalRows.map((row) => row.accountId)) },
      })
      : [];
    const pooledSyncAccountIds = new Set(
      pooledPersonalAccounts.map((account) => account.syncAccountId),
    );
    const effective = new Map<string, AdminSyncAccountDto>();
    for (const row of personalRows) {
      const account = this.toDto(row);
      const { privateDetails: _privateDetails, ...safeAccount } = account;
      effective.set(account.id, {
        ...safeAccount,
        source: 'personal',
        inSystemPool: pooledSyncAccountIds.has(account.id),
      });
    }
    for (const binding of bindings) {
      const account = this.systemAccountToSyncDto(binding.account);
      effective.set(account.id, {
        ...account,
        source: 'system',
        systemAccountId: binding.systemAccountId,
        inSystemPool: true,
      });
    }
    return {
      accounts: [...effective.values()].sort((left, right) => left.email.localeCompare(right.email)),
    };
  }

  async listForPortal(
    ownerId: string,
    canEditOfficialMetadata = false,
  ): Promise<{ accounts: PortalSyncAccountDto[] }> {
    const data = await this.listForAdmin(ownerId);
    return {
      accounts: data.accounts.map(({ auth: _auth, ...account }) => ({
        ...account,
        metadataEditable: account.source === 'system'
          ? canEditOfficialMetadata
          : true,
      })),
    };
  }

  async countSystemAccountBindingsByUserIds(userIds: string[]) {
    const uniqueUserIds = [...new Set(userIds)];
    const counts = new Map<string, number>();
    if (!uniqueUserIds.length) return counts;

    const bindings = await this.systemBindings.find({
      where: { userId: In(uniqueUserIds) },
    });
    for (const binding of bindings) {
      counts.set(binding.userId, (counts.get(binding.userId) ?? 0) + 1);
    }
    return counts;
  }

  async listSystemAccounts(
    page = 1,
    pageSize = 20,
    filters: SystemAccountListFilters = {},
    sortBy: 'createdAt' | 'boundUserCount' = 'createdAt',
    sortOrder: 'asc' | 'desc' = 'desc',
    addedByUserId?: string,
  ) {
    const normalizedFilters = {
      search: filters.search?.trim(),
      email: filters.email?.trim(),
      plan: filters.plan?.trim(),
      note: filters.note?.trim(),
      addedByEmail: filters.addedByEmail?.trim(),
      boundUserCount: filters.boundUserCount,
    };
    const legacyBoundUserCount = normalizedFilters.search && /^\d+$/.test(normalizedFilters.search)
      && Number.isSafeInteger(Number(normalizedFilters.search))
      ? Number(normalizedFilters.search)
      : undefined;
    const hasFilters = Object.values(normalizedFilters).some((value) => value !== undefined && value !== '');

    if (sortBy === 'boundUserCount' || hasFilters) {
      const query = this.systemAccounts
        .createQueryBuilder('account')
        .select('account.id', 'id')
        .addSelect('COUNT(binding.userId)', 'boundUserCount')
        .leftJoin('account.bindings', 'binding')
        .groupBy('account.id');
      if (sortBy === 'boundUserCount') {
        query
          .orderBy('"boundUserCount"', sortOrder === 'asc' ? 'ASC' : 'DESC')
          .addOrderBy('account.createdAt', 'DESC');
      } else {
        query.orderBy('account.createdAt', sortOrder === 'asc' ? 'ASC' : 'DESC');
      }
      query.offset((page - 1) * pageSize).limit(pageSize);

      const applyFilters = (target: SelectQueryBuilder<SystemAccountEntity>) => {
        if (normalizedFilters.search) {
          const boundUserCountCondition = legacyBoundUserCount === undefined
            ? ''
            : ` OR (
              SELECT COUNT(*)
              FROM "system_account_bindings" "searchBinding"
              WHERE "searchBinding"."systemAccountId" = account.id
            ) = :legacyBoundUserCount`;
          target.andWhere(
            `(account.email ILIKE :search OR account.note ILIKE :search OR account.plan ILIKE :search OR account.addedByEmail ILIKE :search${boundUserCountCondition})`,
            {
              search: `%${normalizedFilters.search}%`,
              ...(legacyBoundUserCount === undefined ? {} : { legacyBoundUserCount }),
            },
          );
        }
        if (normalizedFilters.email) {
          target.andWhere('account.email ILIKE :email', { email: `%${normalizedFilters.email}%` });
        }
        if (normalizedFilters.plan) {
          target.andWhere('account.plan ILIKE :plan', { plan: `%${normalizedFilters.plan}%` });
        }
        if (normalizedFilters.note) {
          target.andWhere('account.note ILIKE :note', { note: `%${normalizedFilters.note}%` });
        }
        if (normalizedFilters.addedByEmail) {
          target.andWhere('account.addedByEmail ILIKE :addedByEmail', {
            addedByEmail: `%${normalizedFilters.addedByEmail}%`,
          });
        }
        if (normalizedFilters.boundUserCount !== undefined) {
          target.andWhere(`(
            SELECT COUNT(*)
            FROM "system_account_bindings" "filterBinding"
            WHERE "filterBinding"."systemAccountId" = account.id
          ) = :boundUserCount`, { boundUserCount: normalizedFilters.boundUserCount });
        }
        if (addedByUserId) {
          target.andWhere('account.addedByUserId = :addedByUserId', { addedByUserId });
        }
        return target;
      };
      applyFilters(query);

      const countQuery = applyFilters(this.systemAccounts.createQueryBuilder('account'));
      const [rows, total] = await Promise.all([
        query.getRawMany<{ id: string }>(),
        countQuery.getCount(),
      ]);
      const ids = rows.map((row) => row.id);
      if (!ids.length) return { items: [], total, page, pageSize };

      const accounts = await this.systemAccounts.find({
        where: { id: In(ids) },
        relations: { bindings: true },
      });
      const byId = new Map(accounts.map((account) => [account.id, account]));
      return {
        items: ids
          .map((id) => byId.get(id))
          .filter((account): account is SystemAccountEntity => Boolean(account))
          .map((account) => this.presentSystemAccount(account)),
        total,
        page,
        pageSize,
      };
    }

    const [items, total] = await this.systemAccounts.findAndCount({
      where: addedByUserId ? { addedByUserId } : undefined,
      relations: { bindings: true },
      order: { createdAt: sortOrder === 'asc' ? 'ASC' : 'DESC' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    });
    return {
      items: items.map((account) => this.presentSystemAccount(account)),
      total,
      page,
      pageSize,
    };
  }

  async createSystemAccount(input: SystemAccountInput, origin?: SystemAccountOrigin) {
    const auth = this.normalizeSystemAccountAuth(input.auth);
    const identity = this.systemAccountIdentity(auth);
    const existing = await this.systemAccounts.findOne({
      where: { syncAccountId: identity.syncAccountId },
    });
    if (existing) throw new ConflictException('Official account already exists in the system pool');
    const account = this.systemAccounts.create({
      ...identity,
      auth,
      note: input.note?.trim() ?? '',
      expiresAt: input.expiresAt?.trim() ?? '',
      usage: input.usage ?? {},
      source: origin?.source ?? 'admin',
      addedByUserId: origin?.addedByUserId ?? null,
      addedByEmail: origin?.addedByEmail ?? null,
      sourceAccountId: origin?.sourceAccountId ?? null,
      lastModifiedAt: new Date(),
    });
    const saved = await this.systemAccounts.save(account);
    return this.presentSystemAccount({ ...saved, bindings: [] });
  }

  async createSystemAccountFromPersonal(
    ownerId: string,
    accountId: string,
    origin?: SystemAccountOrigin,
  ) {
    const account = await this.accounts.findOne({
      where: { ownerId, accountId, deletedAt: IsNull() },
    });
    if (!account) throw new NotFoundException('Synced account not found');
    return this.createSystemAccount({
      auth: this.hydratePersonalSystemAccountAuth(account),
      note: account.note,
      expiresAt: account.expiresAt,
      usage: account.usage,
    }, origin);
  }

  async updateSystemAccount(id: string, patch: SystemAccountPatch, addedByUserId?: string) {
    const account = await this.systemAccounts.findOne({
      where: { id, ...(addedByUserId ? { addedByUserId } : {}) },
      relations: { bindings: true },
    });
    if (!account) throw new NotFoundException('Official account not found');
    if (patch.auth !== undefined) {
      const auth = this.normalizeSystemAccountAuth(patch.auth);
      const identity = this.systemAccountIdentity(auth);
      const duplicate = await this.systemAccounts.findOne({
        where: { syncAccountId: identity.syncAccountId },
      });
      if (duplicate && duplicate.id !== id) {
        throw new ConflictException('Official account already exists in the system pool');
      }
      account.auth = auth;
      account.syncAccountId = identity.syncAccountId;
      account.email = identity.email;
      account.plan = identity.plan;
      account.codexAccountId = identity.codexAccountId;
    }
    if (patch.note !== undefined) account.note = patch.note.trim();
    if (patch.expiresAt !== undefined) account.expiresAt = patch.expiresAt.trim();
    if (patch.usage !== undefined) account.usage = patch.usage;
    account.lastModifiedAt = new Date();
    const saved = await this.systemAccounts.save(account);
    await this.invalidateAccountCaches(account.bindings.map((binding) => binding.userId));
    return this.presentSystemAccount(saved);
  }

  async deleteSystemAccount(id: string, addedByUserId?: string) {
    const account = await this.systemAccounts.findOne({
      where: { id, ...(addedByUserId ? { addedByUserId } : {}) },
      relations: { bindings: true },
    });
    if (!account) throw new NotFoundException('Official account not found');
    const userIds = account.bindings.map((binding) => binding.userId);
    await this.systemAccounts.delete({ id });
    await this.invalidateAccountCaches(userIds);
    return { id };
  }

  async deleteSystemAccounts(ids: string[], addedByUserId?: string) {
    const accountIds = [...new Set(ids)];
    const accounts = await this.systemAccounts.find({
      where: { id: In(accountIds), ...(addedByUserId ? { addedByUserId } : {}) },
      relations: { bindings: true },
    });
    if (accounts.length !== accountIds.length) {
      throw new NotFoundException('Official account not found');
    }
    const userIds = accounts.flatMap((account) => (
      account.bindings.map((binding) => binding.userId)
    ));
    await this.systemAccounts.delete({ id: In(accountIds) });
    await this.invalidateAccountCaches(userIds);
    return { ids: accountIds, count: accountIds.length };
  }

  async listSystemAccountBindingIds(id: string, addedByUserId?: string) {
    const account = await this.systemAccounts.findOne({
      where: { id, ...(addedByUserId ? { addedByUserId } : {}) },
    });
    if (!account) throw new NotFoundException('Official account not found');
    const bindings = await this.systemBindings.find({
      where: { systemAccountId: id },
      order: { createdAt: 'ASC' },
    });
    return { userIds: bindings.map((binding) => binding.userId) };
  }

  async bindSystemAccounts(
    systemAccountIds: string[],
    userIds: string[],
    addedByUserId?: string,
  ) {
    const accountIds = [...new Set(systemAccountIds)];
    const targetUserIds = [...new Set(userIds)];
    const accounts = await this.requireSystemAccounts(accountIds, addedByUserId);
    const accountEmails = new Map(accounts.map((account) => [account.id, account.email]));
    const existing = await this.systemBindings.find({
      where: {
        systemAccountId: In(accountIds),
        userId: In(targetUserIds),
      },
    });
    const existingKeys = new Set(
      existing.map((binding) => `${binding.systemAccountId}:${binding.userId}`),
    );
    const additions = accountIds.flatMap((systemAccountId) => targetUserIds
      .filter((userId) => !existingKeys.has(`${systemAccountId}:${userId}`))
      .map((userId) => this.systemBindings.create({ systemAccountId, userId })));
    if (additions.length) await this.systemBindings.save(additions);
    await this.invalidateAccountCaches(targetUserIds);
    return {
      count: additions.length,
      createdBindings: additions.map((binding): CreatedSystemAccountBinding => ({
        systemAccountId: binding.systemAccountId,
        systemAccountEmail: accountEmails.get(binding.systemAccountId)!,
        userId: binding.userId,
      })),
    };
  }

  async unbindSystemAccounts(
    systemAccountIds: string[],
    userIds: string[],
    addedByUserId?: string,
  ) {
    const accountIds = [...new Set(systemAccountIds)];
    const targetUserIds = [...new Set(userIds)];
    await this.requireSystemAccounts(accountIds, addedByUserId);
    const result = await this.systemBindings.delete({
      systemAccountId: In(accountIds),
      userId: In(targetUserIds),
    });
    await this.invalidateAccountCaches(targetUserIds);
    return { count: result.affected ?? 0 };
  }

  async replaceProviders(ownerId: string, dto: PutSyncProvidersDto) {
    await this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(SyncedProviderEntity);
      if (!dto.providers.length) return;
      for (const provider of dto.providers) {
        const existing = await repo.findOne({ where: { ownerId, providerId: provider.id } });
        const merged = this.mergeIncomingProvider(existing, ownerId, provider);
        if (merged) await repo.save(repo.create(merged));
      }
    });
    await this.redis.del(this.providerCacheKey(ownerId));
    return { count: dto.providers.length };
  }

  async upsertProvider(ownerId: string, providerId: string, provider: SyncProviderDto) {
    if (provider.id !== providerId) {
      throw new BadRequestException('Route provider id does not match request body');
    }
    await this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(SyncedProviderEntity);
      const existing = await repo.findOne({ where: { ownerId, providerId } });
      const merged = this.mergeIncomingProvider(existing, ownerId, provider);
      if (merged) await repo.save(repo.create(merged));
    });
    await this.redis.del(this.providerCacheKey(ownerId));
    return { id: providerId };
  }

  async deleteProvider(ownerId: string, providerId: string) {
    await this.providers.update({ ownerId, providerId }, { deletedAt: new Date() });
    await this.redis.del(this.providerCacheKey(ownerId));
    return { id: providerId };
  }

  async getTotpVault(ownerId: string) {
    const vault = await this.totpVaults.findOne({ where: { ownerId } });
    return vault ? readStoredTotpVault(vault) : { entries: [], tombstones: [], modifiedAt: null };
  }

  async putTotpVault(ownerId: string, dto: PutSyncTotpVaultDto) {
    return this.dataSource.transaction(async (manager) => {
      await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [ownerId]);
      const repository = manager.getRepository(SyncedTotpVaultEntity);
      const existing = await repository.findOne({ where: { ownerId } });
      const merged = mergeTotpVault(existing, dto);
      const vault = existing ?? repository.create({ ownerId });
      vault.entries = merged.entries;
      vault.tombstones = merged.tombstones;
      vault.modifiedAt = new Date(merged.modifiedAt);
      await repository.save(vault);
      return merged;
    });
  }

  async listDeletedProviders(ownerId: string): Promise<{ providers: DeletedSyncProviderDto[] }> {
    const rows = await this.providers.find({
      where: { ownerId, deletedAt: Not(IsNull()) },
      order: { deletedAt: 'DESC' },
    });
    return {
      providers: rows.map((row) => ({
        id: row.providerId,
        name: row.name,
        baseUrl: row.baseUrl,
        model: row.model,
        deletedAt: row.deletedAt!.toISOString(),
      })),
    };
  }

  async restoreDeletedProvider(ownerId: string, providerId: string) {
    const provider = await this.providers.findOne({
      where: { ownerId, providerId, deletedAt: Not(IsNull()) },
    });
    if (!provider) throw new NotFoundException('Deleted provider not found');
    provider.deletedAt = null;
    const saved = await this.providers.save(provider);
    await this.redis.del(this.providerCacheKey(ownerId));
    return this.toProviderDto(saved);
  }

  async updateForAdmin(
    ownerId: string,
    accountId: string,
    patch: Partial<SyncAccountDto>,
    canEditOfficialMetadata = false,
  ) {
    const bindings = await this.loadSystemBindings(ownerId);
    const binding = bindings.find((item) => item.account.syncAccountId === accountId);
    if (binding) {
      if (!canEditOfficialMetadata) {
        throw new ForbiddenException('You cannot edit official account notes or expiration dates');
      }
      return this.updateSystemAccount(binding.systemAccountId, {
        ...(patch.note !== undefined ? { note: patch.note ?? '' } : {}),
        ...(patch.expiresAt !== undefined ? { expiresAt: patch.expiresAt ?? '' } : {}),
      });
    }
    const account = await this.accounts.findOne({
      where: { ownerId, accountId, deletedAt: IsNull() },
    });
    if (!account) throw new NotFoundException('Synced account not found');
    const fieldModifiedAt = this.normalizeAccountFieldModifiedAt(
      account.fieldModifiedAt,
      this.formatLastModifiedAt(account.lastModifiedAt ?? account.updatedAt),
    );
    const modifiedAt = this.formatLastModifiedAt(
      patch.lastModifiedAt === undefined ? new Date() : this.parseLastModifiedAt(patch.lastModifiedAt),
    );
    if (patch.active === true) {
      await this.accounts.update({ ownerId }, { active: false });
    }
    if (patch.email !== undefined) account.email = patch.email;
    if (patch.plan !== undefined) account.plan = patch.plan;
    if (patch.accountId !== undefined) account.codexAccountId = patch.accountId ?? null;
    if (patch.auth !== undefined) account.auth = patch.auth;
    if (patch.email !== undefined || patch.plan !== undefined || patch.accountId !== undefined || patch.auth !== undefined) {
      fieldModifiedAt.auth = modifiedAt;
    }
    if (patch.note !== undefined) {
      account.note = patch.note ?? '';
      fieldModifiedAt.note = modifiedAt;
    }
    if (patch.expiresAt !== undefined) {
      account.expiresAt = patch.expiresAt ?? '';
      fieldModifiedAt.expiresAt = modifiedAt;
    }
    if (patch.usage !== undefined) {
      account.usage = patch.usage ?? {};
      fieldModifiedAt.usage = modifiedAt;
    }
    if (patch.active !== undefined) {
      account.active = patch.active;
      fieldModifiedAt.active = modifiedAt;
    }
    if (patch.autoSwitchPriority !== undefined) {
      account.autoSwitchPriority = patch.autoSwitchPriority;
      fieldModifiedAt.autoSwitchPriority = modifiedAt;
    }
    if (patch.autoSwitchThreshold !== undefined) {
      account.autoSwitchThreshold = patch.autoSwitchThreshold;
      fieldModifiedAt.autoSwitchThreshold = modifiedAt;
    }
    account.fieldModifiedAt = fieldModifiedAt;
    account.lastModifiedAt = this.latestAccountFieldModifiedAt(fieldModifiedAt);
    const saved = await this.accounts.save(account);
    await this.redis.del(this.cacheKey(ownerId));
    return this.toDto(saved);
  }

  private mergeIncomingAccount(
    existing: SyncedAccountEntity | null,
    ownerId: string,
    incoming: SyncAccountDto,
  ): AccountMergeResult | null {
    const incomingFieldModifiedAt = this.normalizeAccountFieldModifiedAt(
      incoming.fieldModifiedAt,
      incoming.lastModifiedAt,
    );
    const incomingLastModifiedAt = this.latestAccountFieldModifiedAt(incomingFieldModifiedAt);
    if (existing?.deletedAt) return null;
    if (!existing) {
      return {
        activeApplied: true,
        account: {
          id: undefined,
          ownerId,
          accountId: incoming.id,
          email: incoming.email,
          note: incoming.note ?? '',
          expiresAt: incoming.expiresAt ?? '',
          privateDetails: incoming.privateDetails ?? {},
          plan: incoming.plan,
          codexAccountId: incoming.accountId ?? null,
          active: incoming.active,
          autoSwitchPriority: incoming.autoSwitchPriority ?? 0,
          autoSwitchThreshold: incoming.autoSwitchThreshold ?? 0,
          usage: incoming.usage ?? {},
          auth: incoming.auth,
          deletedAt: null,
          fieldModifiedAt: incomingFieldModifiedAt,
          lastModifiedAt: incomingLastModifiedAt,
        },
      };
    }

    const existingFieldModifiedAt = this.normalizeAccountFieldModifiedAt(
      existing.fieldModifiedAt,
      this.formatLastModifiedAt(existing.lastModifiedAt ?? existing.updatedAt),
    );
    const incomingHasFieldVersions = Object.values(incoming.fieldModifiedAt ?? {})
      .some((value) => typeof value === 'string' && value.trim().length > 0);
    const existingHasFieldVersions = Object.values(existing.fieldModifiedAt ?? {})
      .some((value) => typeof value === 'string' && value.trim().length > 0);
    const account: Partial<SyncedAccountEntity> = {
      id: existing.id,
      ownerId,
      accountId: incoming.id,
      email: existing.email,
      note: existing.note,
      expiresAt: existing.expiresAt,
      privateDetails: existing.privateDetails ?? {},
      plan: existing.plan,
      codexAccountId: existing.codexAccountId ?? null,
      active: existing.active,
      autoSwitchPriority: existing.autoSwitchPriority ?? 0,
      autoSwitchThreshold: existing.autoSwitchThreshold ?? 0,
      usage: existing.usage,
      auth: existing.auth,
      deletedAt: null,
      lastModifiedAt: existing.lastModifiedAt,
      fieldModifiedAt: { ...existingFieldModifiedAt },
    };
    let changed = false;
    let activeApplied = false;
    if (this.isIncomingFieldNewer(existingFieldModifiedAt.auth, incomingFieldModifiedAt.auth)) {
      account.email = incoming.email;
      account.plan = incoming.plan;
      account.codexAccountId = incoming.accountId ?? null;
      account.auth = incoming.auth;
      account.fieldModifiedAt!.auth = incomingFieldModifiedAt.auth;
      changed = true;
    }
    // Legacy desktop clients only send one account-wide timestamp. Once an account has
    // field-level versions, letting that legacy timestamp update metadata would recreate the
    // usage-refresh-overwrites-note bug. Preserve note and expiration until that client updates.
    if ((incomingHasFieldVersions || !existingHasFieldVersions)
      && this.isIncomingFieldNewer(existingFieldModifiedAt.note, incomingFieldModifiedAt.note)) {
      account.note = incoming.note ?? '';
      account.fieldModifiedAt!.note = incomingFieldModifiedAt.note;
      changed = true;
    }
    if ((incomingHasFieldVersions || !existingHasFieldVersions)
      && this.isIncomingFieldNewer(existingFieldModifiedAt.expiresAt, incomingFieldModifiedAt.expiresAt)) {
      account.expiresAt = incoming.expiresAt ?? '';
      account.fieldModifiedAt!.expiresAt = incomingFieldModifiedAt.expiresAt;
      changed = true;
    }
    if (incoming.privateDetails !== undefined
      && this.isIncomingFieldNewer(
        existingFieldModifiedAt.privateDetails,
        incomingFieldModifiedAt.privateDetails,
      )) {
      account.privateDetails = incoming.privateDetails;
      account.fieldModifiedAt!.privateDetails = incomingFieldModifiedAt.privateDetails;
      changed = true;
    }
    if (this.isIncomingFieldNewer(existingFieldModifiedAt.usage, incomingFieldModifiedAt.usage)) {
      account.usage = incoming.usage ?? {};
      const usagePlan = this.stringValue(this.objectValue(incoming.usage)?.plan);
      if (usagePlan) account.plan = usagePlan;
      account.fieldModifiedAt!.usage = incomingFieldModifiedAt.usage;
      changed = true;
    }
    if (this.isIncomingFieldNewer(existingFieldModifiedAt.active, incomingFieldModifiedAt.active)) {
      account.active = incoming.active;
      account.fieldModifiedAt!.active = incomingFieldModifiedAt.active;
      activeApplied = true;
      changed = true;
    }
    if (incoming.autoSwitchPriority !== undefined
      && (incomingHasFieldVersions || !existingHasFieldVersions)
      && this.isIncomingFieldNewer(
        existingFieldModifiedAt.autoSwitchPriority,
        incomingFieldModifiedAt.autoSwitchPriority,
      )) {
      account.autoSwitchPriority = incoming.autoSwitchPriority;
      account.fieldModifiedAt!.autoSwitchPriority = incomingFieldModifiedAt.autoSwitchPriority;
      changed = true;
    }
    if (incoming.autoSwitchThreshold !== undefined
      && (incomingHasFieldVersions || !existingHasFieldVersions)
      && this.isIncomingFieldNewer(
        existingFieldModifiedAt.autoSwitchThreshold,
        incomingFieldModifiedAt.autoSwitchThreshold,
      )) {
      account.autoSwitchThreshold = incoming.autoSwitchThreshold;
      account.fieldModifiedAt!.autoSwitchThreshold = incomingFieldModifiedAt.autoSwitchThreshold;
      changed = true;
    }
    if (!changed) return null;
    account.lastModifiedAt = this.latestAccountFieldModifiedAt(account.fieldModifiedAt!);
    return { account, activeApplied };
  }

  private normalizeAccountFieldModifiedAt(
    value: Partial<AccountFieldModifiedAt> | undefined,
    fallback: string | undefined,
  ): AccountFieldModifiedAt {
    const defaultValue = this.formatLastModifiedAt(this.parseLastModifiedAt(fallback));
    return {
      auth: this.formatLastModifiedAt(this.parseLastModifiedAt(value?.auth ?? defaultValue)),
      note: this.formatLastModifiedAt(this.parseLastModifiedAt(value?.note ?? defaultValue)),
      expiresAt: this.formatLastModifiedAt(this.parseLastModifiedAt(value?.expiresAt ?? defaultValue)),
      privateDetails: this.formatLastModifiedAt(
        this.parseLastModifiedAt(value?.privateDetails ?? defaultValue),
      ),
      usage: this.formatLastModifiedAt(this.parseLastModifiedAt(value?.usage ?? defaultValue)),
      active: this.formatLastModifiedAt(this.parseLastModifiedAt(value?.active ?? defaultValue)),
      autoSwitchPriority: this.formatLastModifiedAt(
        this.parseLastModifiedAt(value?.autoSwitchPriority ?? defaultValue),
      ),
      autoSwitchThreshold: this.formatLastModifiedAt(
        this.parseLastModifiedAt(value?.autoSwitchThreshold ?? defaultValue),
      ),
    };
  }

  private isIncomingFieldNewer(existing: string, incoming: string) {
    return this.parseLastModifiedAt(incoming) > this.parseLastModifiedAt(existing);
  }

  private latestAccountFieldModifiedAt(values: Partial<AccountFieldModifiedAt>) {
    return new Date(Math.max(
      this.parseLastModifiedAt(values.auth).getTime(),
      this.parseLastModifiedAt(values.note).getTime(),
      this.parseLastModifiedAt(values.expiresAt).getTime(),
      this.parseLastModifiedAt(values.privateDetails).getTime(),
      this.parseLastModifiedAt(values.usage).getTime(),
      this.parseLastModifiedAt(values.active).getTime(),
      this.parseLastModifiedAt(values.autoSwitchPriority).getTime(),
      this.parseLastModifiedAt(values.autoSwitchThreshold).getTime(),
    ));
  }

  private toDto(row: SyncedAccountEntity): SyncAccountDto {
    const privateDetails = {
      password: this.stringValue(row.privateDetails?.password) ?? '',
      phoneNumber: this.stringValue(row.privateDetails?.phoneNumber) ?? '',
      totpSecret: this.stringValue(row.privateDetails?.totpSecret) ?? '',
    };
    const hasPrivateDetails = Object.values(privateDetails).some((value) => value.length > 0);
    return {
      id: row.accountId,
      email: row.email,
      note: row.note,
      expiresAt: row.expiresAt,
      ...(hasPrivateDetails ? { privateDetails } : {}),
      plan: row.plan,
      accountId: row.codexAccountId,
      active: row.active,
      autoSwitchPriority: row.autoSwitchPriority ?? 0,
      autoSwitchThreshold: row.autoSwitchThreshold ?? 0,
      usage: row.usage,
      lastModifiedAt: this.formatLastModifiedAt(row.lastModifiedAt ?? row.updatedAt),
      fieldModifiedAt: this.normalizeAccountFieldModifiedAt(
        row.fieldModifiedAt,
        this.formatLastModifiedAt(row.lastModifiedAt ?? row.updatedAt),
      ),
      auth: row.auth,
    };
  }

  private toProviderDto(row: SyncedProviderEntity): SyncProviderDto {
    const fallback = this.formatLastModifiedAt(row.lastModifiedAt ?? row.updatedAt);
    return {
      id: row.providerId,
      kind: row.kind ?? 'custom',
      name: row.name,
      group: row.group ?? '',
      baseUrl: row.baseUrl,
      apiKey: row.apiKey,
      model: row.model,
      models: row.models ?? [],
      modelReasoningEfforts: this.normalizeModelReasoningEfforts(
        row.modelReasoningEfforts,
        row.models,
      ),
      modelContextWindows: this.normalizeModelContextWindows(row.modelContextWindows, row.models),
      modelApiFormats: this.normalizeModelApiFormats(row.modelApiFormats, row.models),
      imageInputModels: row.imageInputModels ?? [],
      contextWindow: row.contextWindow,
      modelSelectionControlledByCodex: row.modelSelectionControlledByCodex,
      apiFormat: row.apiFormat,
      balancePlatform: row.balancePlatform,
      balanceQueryUrl: row.balanceQueryUrl,
      balanceQueryToken: row.balanceQueryToken,
      walletQueryUrl: row.walletQueryUrl,
      walletQueryToken: row.walletQueryToken,
      walletUsername: row.walletUsername,
      walletPassword: row.walletPassword,
      lastModifiedAt: fallback,
      fieldModifiedAt: this.normalizeProviderFieldModifiedAt(row.fieldModifiedAt, fallback),
    };
  }

  private mergeIncomingProvider(
    existing: SyncedProviderEntity | null,
    ownerId: string,
    incoming: SyncProviderDto,
  ): Partial<SyncedProviderEntity> | null {
    if (existing?.deletedAt) return null;
    const incomingVersions = this.normalizeProviderFieldModifiedAt(
      incoming.fieldModifiedAt,
      incoming.lastModifiedAt,
    );
    const incomingValues: Record<keyof ProviderFieldModifiedAt, unknown> = {
      kind: incoming.kind ?? 'custom',
      name: incoming.name,
      group: incoming.group?.trim() ?? '',
      baseUrl: incoming.baseUrl,
      apiKey: incoming.apiKey,
      model: incoming.model,
      models: incoming.models ?? [],
      modelReasoningEfforts: this.normalizeModelReasoningEfforts(
        incoming.modelReasoningEfforts,
        incoming.models,
      ),
      modelContextWindows: this.normalizeModelContextWindows(
        incoming.modelContextWindows,
        incoming.models,
      ),
      modelApiFormats: this.normalizeModelApiFormats(incoming.modelApiFormats, incoming.models),
      imageInputModels: incoming.imageInputModels ?? [],
      contextWindow: incoming.contextWindow ?? null,
      modelSelectionControlledByCodex: incoming.modelSelectionControlledByCodex ?? false,
      apiFormat: incoming.apiFormat,
      balancePlatform: incoming.balancePlatform ?? null,
      balanceQueryUrl: incoming.balanceQueryUrl ?? null,
      balanceQueryToken: incoming.balanceQueryToken ?? null,
      walletQueryUrl: incoming.walletQueryUrl ?? null,
      walletQueryToken: incoming.walletQueryToken ?? null,
      walletUsername: incoming.walletUsername ?? null,
      walletPassword: incoming.walletPassword ?? null,
    };
    if (!existing) {
      return {
        ownerId,
        providerId: incoming.id,
        ...(incomingValues as Omit<Partial<SyncedProviderEntity>, 'id'>),
        deletedAt: null,
        fieldModifiedAt: incomingVersions,
        lastModifiedAt: this.latestProviderFieldModifiedAt(incomingVersions),
      };
    }

    const existingFallback = this.formatLastModifiedAt(existing.lastModifiedAt ?? existing.updatedAt);
    const existingVersions = this.normalizeProviderFieldModifiedAt(
      existing.fieldModifiedAt,
      existingFallback,
    );
    const incomingHasFieldVersions = Object.values(incoming.fieldModifiedAt ?? {})
      .some((value) => typeof value === 'string' && value.trim().length > 0);
    const existingHasFieldVersions = Object.values(existing.fieldModifiedAt ?? {})
      .some((value) => typeof value === 'string' && value.trim().length > 0);
    const mergedValues: Record<keyof ProviderFieldModifiedAt, unknown> = {
      kind: existing.kind,
      name: existing.name,
      group: existing.group ?? '',
      baseUrl: existing.baseUrl,
      apiKey: existing.apiKey,
      model: existing.model,
      models: existing.models,
      modelReasoningEfforts: existing.modelReasoningEfforts,
      modelContextWindows: existing.modelContextWindows,
      modelApiFormats: existing.modelApiFormats,
      imageInputModels: existing.imageInputModels,
      contextWindow: existing.contextWindow,
      modelSelectionControlledByCodex: existing.modelSelectionControlledByCodex,
      apiFormat: existing.apiFormat,
      balancePlatform: existing.balancePlatform,
      balanceQueryUrl: existing.balanceQueryUrl,
      balanceQueryToken: existing.balanceQueryToken,
      walletQueryUrl: existing.walletQueryUrl,
      walletQueryToken: existing.walletQueryToken,
      walletUsername: existing.walletUsername,
      walletPassword: existing.walletPassword,
    };
    const mergedVersions = { ...existingVersions };
    let changed = false;
    for (const key of Object.keys(incomingVersions) as (keyof ProviderFieldModifiedAt)[]) {
      if (!incomingHasFieldVersions && existingHasFieldVersions) continue;
      if (!this.isIncomingFieldNewer(existingVersions[key], incomingVersions[key])) continue;
      mergedValues[key] = incomingValues[key];
      mergedVersions[key] = incomingVersions[key];
      changed = true;
    }
    if (!changed) return null;
    return {
      id: existing.id,
      ownerId,
      providerId: incoming.id,
      ...(mergedValues as Omit<Partial<SyncedProviderEntity>, 'id'>),
      deletedAt: null,
      fieldModifiedAt: mergedVersions,
      lastModifiedAt: this.latestProviderFieldModifiedAt(mergedVersions),
    };
  }

  private normalizeProviderFieldModifiedAt(
    value: Partial<ProviderFieldModifiedAt> | undefined,
    fallback: string | undefined,
  ): ProviderFieldModifiedAt {
    const defaultValue = this.formatLastModifiedAt(this.parseLastModifiedAt(fallback));
    const normalized = {} as ProviderFieldModifiedAt;
    for (const key of [
      'kind', 'name', 'group', 'baseUrl', 'apiKey', 'model', 'models', 'modelReasoningEfforts',
      'modelContextWindows', 'modelApiFormats',
      'imageInputModels', 'contextWindow',
      'modelSelectionControlledByCodex', 'apiFormat', 'balancePlatform',
      'balanceQueryUrl', 'balanceQueryToken', 'walletQueryUrl', 'walletQueryToken',
      'walletUsername', 'walletPassword',
    ] as (keyof ProviderFieldModifiedAt)[]) {
      normalized[key] = this.formatLastModifiedAt(
        this.parseLastModifiedAt(value?.[key] ?? defaultValue),
      );
    }
    return normalized;
  }

  private normalizeModelReasoningEfforts(value: unknown, models: string[]) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    const configured = value as Record<string, unknown>;
    const normalized: Record<string, string[]> = {};
    for (const model of models) {
      const efforts = configured[model];
      if (!Array.isArray(efforts)) continue;
      const valid = [...new Set(efforts.filter((effort): effort is string => (
        typeof effort === 'string' && PROVIDER_REASONING_EFFORTS.has(effort)
      )))];
      if (valid.length) normalized[model] = valid;
    }
    return normalized;
  }

  private normalizeModelContextWindows(value: unknown, models: string[]) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    const configured = value as Record<string, unknown>;
    const normalized: Record<string, number> = {};
    for (const model of models) {
      const contextWindow = configured[model];
      const isValid = typeof contextWindow === 'number'
        && Number.isSafeInteger(contextWindow)
        && contextWindow > 0;
      if (isValid) {
        normalized[model] = contextWindow;
      }
    }
    return normalized;
  }

  private normalizeModelApiFormats(value: unknown, models: string[]) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    const configured = value as Record<string, unknown>;
    const normalized: Record<string, SyncProviderDto['apiFormat']> = {};
    for (const model of models) {
      const apiFormat = configured[model];
      if (typeof apiFormat !== 'string' || !PROVIDER_API_FORMATS.has(apiFormat)) continue;
      normalized[model] = apiFormat as SyncProviderDto['apiFormat'];
    }
    return normalized;
  }

  private latestProviderFieldModifiedAt(values: ProviderFieldModifiedAt) {
    return new Date(Math.max(...Object.values(values)
      .map((value) => this.parseLastModifiedAt(value).getTime())));
  }

  private async loadEffectiveAccountState(ownerId: string) {
    const [personalRows, bindings] = await Promise.all([
      this.accounts.find({ where: { ownerId }, order: { email: 'ASC' } }),
      this.loadSystemBindings(ownerId),
    ]);
    const deletedAccountIds = new Set(personalRows
      .filter((row) => Boolean(row.deletedAt))
      .map((row) => row.accountId));
    const effective = new Map<string, EffectiveSyncAccountDto>(personalRows
      .filter((row) => !row.deletedAt).map((row) => {
      const account = this.toDto(row);
      return [account.id, {
        ...account,
        official: false,
        metadataEditable: true,
      }] as const;
    }));
    const personalByAccountId = new Map(personalRows.map((row) => [row.accountId, row]));
    for (const binding of bindings) {
      const account = this.withPersonalPrivateDetails(
        this.systemAccountToSyncDto(binding.account),
        personalByAccountId.get(binding.account.syncAccountId),
      );
      effective.set(account.id, {
        ...account,
        official: true,
        metadataEditable: false,
      });
      deletedAccountIds.delete(account.id);
    }
    return {
      accounts: [...effective.values()].sort((left, right) => left.email.localeCompare(right.email)),
      deletedAccountIds: [...deletedAccountIds].sort(),
    };
  }

  private async markAccountDeleted(
    ownerId: string,
    accountId: string,
    deletedAt: Date,
    systemAccount?: SystemAccountEntity,
  ) {
    const existing = await this.accounts.findOne({ where: { ownerId, accountId } });
    if (existing) {
      await this.accounts.update({ ownerId, accountId }, { active: false, deletedAt });
      return;
    }
    if (!systemAccount) return;
    const fallbackModifiedAt = this.formatLastModifiedAt(
      systemAccount.lastModifiedAt ?? systemAccount.updatedAt,
    );
    await this.accounts.save(this.accounts.create({
      ownerId,
      accountId,
      email: systemAccount.email,
      note: systemAccount.note,
      expiresAt: systemAccount.expiresAt,
      plan: systemAccount.plan,
      codexAccountId: systemAccount.codexAccountId ?? null,
      active: false,
      autoSwitchPriority: 0,
      autoSwitchThreshold: 0,
      usage: systemAccount.usage,
      auth: systemAccount.auth,
      fieldModifiedAt: this.normalizeAccountFieldModifiedAt(undefined, fallbackModifiedAt),
      lastModifiedAt: systemAccount.lastModifiedAt ?? systemAccount.updatedAt,
      deletedAt,
    }));
  }

  private loadSystemBindings(ownerId: string) {
    return this.systemBindings.find({
      where: { userId: ownerId },
      relations: { account: true },
    });
  }

  private async boundSystemSyncIds(ownerId: string) {
    const bindings = await this.loadSystemBindings(ownerId);
    return new Set(bindings.map((binding) => binding.account.syncAccountId));
  }

  private async isSystemAccountBound(ownerId: string, syncAccountId: string) {
    const bindings = await this.loadSystemBindings(ownerId);
    return bindings.some((binding) => binding.account.syncAccountId === syncAccountId);
  }

  private systemAccountToSyncDto(account: SystemAccountEntity): SyncAccountDto {
    return {
      id: account.syncAccountId,
      email: account.email,
      note: account.note,
      expiresAt: account.expiresAt,
      plan: account.plan,
      accountId: account.codexAccountId,
      active: false,
      autoSwitchPriority: 0,
      autoSwitchThreshold: 0,
      usage: account.usage,
      lastModifiedAt: this.formatLastModifiedAt(account.lastModifiedAt ?? account.updatedAt),
      auth: account.auth,
    };
  }

  private mobileAccountSummary(account: EffectiveSyncAccountDto): MobileSyncAccountDto {
    const { auth, ...summary } = account;
    const tokens = this.objectValue(auth.tokens);
    const codexAccessToken = this.stringValue(tokens?.access_token);
    return {
      ...summary,
      ...(codexAccessToken ? { codexAccessToken } : {}),
    };
  }

  private async mobileAccountById(ownerId: string, accountId: string) {
    const account = (await this.loadEffectiveAccountState(ownerId)).accounts
      .find((candidate) => candidate.id === accountId);
    if (!account) throw new NotFoundException('Synced account not found');
    return this.mobileAccountSummary(account);
  }

  private withPersonalPrivateDetails(
    account: SyncAccountDto,
    personal: SyncedAccountEntity | undefined,
  ): SyncAccountDto {
    if (!personal) return account;
    const personalDto = this.toDto(personal);
    if (!personalDto.privateDetails) return account;
    const accountVersions = this.normalizeAccountFieldModifiedAt(
      account.fieldModifiedAt,
      account.lastModifiedAt,
    );
    const personalVersions = this.normalizeAccountFieldModifiedAt(
      personalDto.fieldModifiedAt,
      personalDto.lastModifiedAt,
    );
    accountVersions.privateDetails = personalVersions.privateDetails;
    return {
      ...account,
      privateDetails: personalDto.privateDetails,
      fieldModifiedAt: accountVersions,
      lastModifiedAt: this.latestAccountFieldModifiedAt(accountVersions).toISOString(),
    };
  }

  private presentSystemAccount(account: SystemAccountEntity): SystemAccountDto {
    return {
      id: account.id,
      syncAccountId: account.syncAccountId,
      email: account.email,
      note: account.note,
      expiresAt: account.expiresAt,
      plan: account.plan,
      accountId: account.codexAccountId,
      usage: account.usage,
      lastModifiedAt: this.formatLastModifiedAt(account.lastModifiedAt ?? account.updatedAt),
      boundUserCount: account.bindings?.length ?? 0,
      source: account.source ?? 'admin',
      addedByUserId: account.addedByUserId ?? null,
      addedByEmail: account.addedByEmail ?? null,
      sourceAccountId: account.sourceAccountId ?? null,
      createdAt: account.createdAt,
      updatedAt: account.updatedAt,
    };
  }

  private systemAccountIdentity(auth: Record<string, unknown>) {
    if (!auth || Array.isArray(auth)) {
      throw new BadRequestException('auth.json must be a JSON object');
    }
    const authMode = this.stringValue(auth.auth_mode);
    const agentIdentity = this.objectValue(auth.agent_identity);
    if (authMode?.toLowerCase() === 'agentidentity' || agentIdentity) {
      if (!agentIdentity) throw new BadRequestException('auth.json is missing agent_identity');
      const runtimeId = this.stringValue(agentIdentity.agent_runtime_id);
      const privateKey = this.stringValue(agentIdentity.agent_private_key);
      const codexAccountId = this.stringValue(agentIdentity.account_id)
        ?? this.stringValue(agentIdentity.chatgpt_account_id);
      const identity = this.stringValue(agentIdentity.chatgpt_user_id);
      if (!runtimeId || !privateKey || !codexAccountId || !identity) {
        throw new BadRequestException('auth.json contains an incomplete Agent Identity credential');
      }
      const normalizedKey = privateKey.replace(/\s+/g, '').replace(/=+$/, '');
      const decodedKey = Buffer.from(privateKey, 'base64');
      if (decodedKey.length < 32 || decodedKey.toString('base64').replace(/=+$/, '') !== normalizedKey) {
        throw new BadRequestException('auth.json contains an invalid Agent Identity private key');
      }
      const email = this.stringValue(agentIdentity.email) ?? 'Unknown account';
      const plan = this.stringValue(agentIdentity.plan_type) ?? 'ChatGPT';
      if (email.length > 240 || plan.length > 80 || codexAccountId.length > 160) {
        throw new BadRequestException('Official account identity exceeds the supported length');
      }
      const syncAccountId = createHash('sha256')
        .update(identity)
        .update('\0')
        .update(codexAccountId)
        .digest()
        .subarray(0, 12)
        .toString('hex');
      return { syncAccountId, email, plan, codexAccountId };
    }
    const tokens = this.objectValue(auth.tokens);
    const accessToken = this.stringValue(tokens?.access_token);
    if (!accessToken) throw new BadRequestException('auth.json is missing tokens.access_token');
    const identityToken = this.stringValue(tokens?.id_token) ?? accessToken;
    const payloadPart = identityToken.split('.')[1];
    let claims: Record<string, unknown> = {};
    if (payloadPart) {
      try {
        claims = this.objectValue(JSON.parse(Buffer.from(payloadPart, 'base64url').toString('utf8')))
          ?? {};
      } catch {
        claims = {};
      }
    }
    const nested = this.objectValue(claims['https://api.openai.com/auth']);
    const profile = this.objectValue(claims['https://api.openai.com/profile']);
    const email = this.stringValue(tokens?.email)
      ?? this.stringValue(claims.email)
      ?? this.stringValue(profile?.email)
      ?? 'Unknown account';
    const plan = this.stringValue(tokens?.plan_type)
      ?? this.stringValue(nested?.chatgpt_plan_type)
      ?? 'ChatGPT';
    const codexAccountId = this.stringValue(tokens?.account_id)
      ?? this.stringValue(tokens?.chatgpt_account_id)
      ?? this.stringValue(nested?.chatgpt_account_id)
      ?? null;
    const identity = this.stringValue(tokens?.chatgpt_user_id)
      ?? this.stringValue(tokens?.user_id)
      ?? this.stringValue(nested?.chatgpt_user_id)
      ?? this.stringValue(nested?.user_id)
      ?? this.stringValue(claims.sub)
      ?? this.stringValue(tokens?.email);
    if (!identity) throw new BadRequestException('auth.json contains an invalid ChatGPT token');
    if (email.length > 240 || plan.length > 80 || (codexAccountId?.length ?? 0) > 160) {
      throw new BadRequestException('Official account identity exceeds the supported length');
    }
    const syncAccountId = createHash('sha256')
      .update(identity)
      .update('\0')
      .update(codexAccountId ?? 'personal')
      .digest()
      .subarray(0, 12)
      .toString('hex');
    return { syncAccountId, email, plan, codexAccountId };
  }

  private async resolveResetCreditAccount(
    ownerId: string,
    accountId: string,
  ): Promise<StoredResetCreditAccount> {
    const bindings = await this.systemBindings.find({
      where: { userId: ownerId },
      relations: { account: true },
    });
    const systemBinding = bindings.find((binding) => binding.account.syncAccountId === accountId);
    if (systemBinding) return { source: 'system', account: systemBinding.account };

    const account = await this.accounts.findOne({
      where: { ownerId, accountId, deletedAt: IsNull() },
    });
    if (!account) throw new NotFoundException('Synced account not found');
    return { source: 'personal', account };
  }

  private async fetchResetCreditsForAccount(
    ownerId: string,
    account: StoredResetCreditAccount,
  ): Promise<ResetCreditsSummaryDto> {
    const response = await this.codexAccountRequest(ownerId, account, RESET_CREDITS_URL);
    if (!response.ok) {
      throw new BadGatewayException(`Codex 重置卡接口返回 HTTP ${response.status}`);
    }
    const payload = await this.responseObject(response, '解析重置卡响应失败');
    const rawCredits = payload.credits;
    if (!Array.isArray(rawCredits)) {
      throw new BadGatewayException('重置卡接口响应缺少 credits 列表');
    }
    const credits = rawCredits.map((value) => {
      const credit = this.objectValue(value) ?? {};
      return {
        issuedAt: this.normalizedResetCreditTimestamp(credit.granted_at ?? credit.created_at),
        expiresAt: this.normalizedResetCreditTimestamp(credit.expires_at),
      };
    });
    credits.sort((left, right) => (left.expiresAt ?? '').localeCompare(right.expiresAt ?? ''));
    return { credits };
  }

  private async codexAccountRequest(
    ownerId: string,
    account: StoredResetCreditAccount,
    url: string,
    init: { method?: 'GET' | 'POST'; body?: string } = {},
  ) {
    let response = await this.sendCodexAccountRequest(account, url, init);
    if (response.status !== 401) return response;

    const refreshedAuth = await this.refreshCodexAccountAuth(account.account.auth);
    await this.persistRefreshedAccountAuth(ownerId, account, refreshedAuth);
    response = await this.sendCodexAccountRequest(account, url, init);
    if (response.status === 401) {
      throw new BadRequestException('该账号的登录凭据已失效，请在桌面端重新登录');
    }
    return response;
  }

  private async sendCodexAccountRequest(
    account: StoredResetCreditAccount,
    url: string,
    init: { method?: 'GET' | 'POST'; body?: string },
  ) {
    const tokens = this.objectValue(account.account.auth.tokens);
    const accessToken = this.stringValue(tokens?.access_token);
    if (!accessToken) {
      throw new BadRequestException('当前账号没有可用的 Codex 登录凭据');
    }
    const headers: Record<string, string> = {
      Authorization: `Bearer ${accessToken}`,
      originator: CODEX_ORIGINATOR,
      'User-Agent': 'codex_cli_rs/0.1.0',
    };
    if (account.account.codexAccountId) {
      headers['ChatGPT-Account-Id'] = account.account.codexAccountId;
    }
    if (init.body) headers['Content-Type'] = 'application/json';

    try {
      return await fetch(
        url,
        withCodexOutboundDispatcher(
          {
            method: init.method ?? 'GET',
            headers,
            body: init.body,
            signal: AbortSignal.timeout(20_000),
          },
          this.codexOutboundDispatcher,
        ),
      );
    } catch {
      throw new BadGatewayException('无法连接 Codex 服务');
    }
  }

  private async refreshCodexAccountAuth(auth: Record<string, unknown>) {
    const tokens = this.objectValue(auth.tokens);
    const refreshToken = this.stringValue(tokens?.refresh_token);
    if (!tokens || !refreshToken) {
      throw new BadRequestException('该账号的登录凭据已失效，请在桌面端重新登录');
    }

    let response: Response;
    try {
      response = await fetch(
        OPENAI_TOKEN_URL,
        withCodexOutboundDispatcher(
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              originator: CODEX_ORIGINATOR,
            },
            body: JSON.stringify({
              client_id: OPENAI_CLIENT_ID,
              grant_type: 'refresh_token',
              refresh_token: refreshToken,
            }),
            signal: AbortSignal.timeout(20_000),
          },
          this.codexOutboundDispatcher,
        ),
      );
    } catch {
      throw new BadGatewayException('无法连接 Codex 登录服务刷新账号凭据');
    }
    if (!response.ok) {
      throw new BadRequestException('该账号的登录凭据已失效，请在桌面端重新登录');
    }

    const payload = await this.responseObject(response, '解析账号凭据刷新响应失败');
    const accessToken = this.stringValue(payload.access_token);
    if (!accessToken) {
      throw new BadGatewayException('账号凭据刷新响应缺少 access_token');
    }
    const nextTokens: Record<string, unknown> = { ...tokens, access_token: accessToken };
    for (const key of ['id_token', 'refresh_token'] as const) {
      const value = this.stringValue(payload[key]);
      if (value) nextTokens[key] = value;
    }
    return {
      ...auth,
      tokens: nextTokens,
      last_refresh: new Date().toISOString(),
    };
  }

  private async persistRefreshedAccountAuth(
    ownerId: string,
    stored: StoredResetCreditAccount,
    auth: Record<string, unknown>,
  ) {
    const modifiedAt = new Date();
    stored.account.auth = auth;
    stored.account.lastModifiedAt = modifiedAt;
    if (stored.source === 'personal') {
      stored.account.fieldModifiedAt = {
        ...stored.account.fieldModifiedAt,
        auth: modifiedAt.toISOString(),
      };
      await this.accounts.save(stored.account);
      await this.redis.del(this.cacheKey(ownerId));
      return;
    }

    await this.systemAccounts.save(stored.account);
    const bindings = await this.systemBindings.find({
      where: { systemAccountId: stored.account.id },
    });
    await this.invalidateAccountCaches(bindings.map((binding) => binding.userId));
  }

  private async responseObject(response: Response, context: string) {
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new BadGatewayException(`${context}：响应不是有效 JSON`);
    }
    const result = this.objectValue(payload);
    if (!result) throw new BadGatewayException(`${context}：响应格式无效`);
    return result;
  }

  private normalizedResetCreditTimestamp(value: unknown): string | null {
    if (typeof value === 'string') {
      const parsed = new Date(value);
      return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
    }
    if (typeof value !== 'number' || !Number.isFinite(value)) return null;
    const milliseconds = Math.abs(value) >= 100_000_000_000 ? value : value * 1000;
    const parsed = new Date(milliseconds);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }

  private normalizeSystemAccountAuth(auth: Record<string, unknown>): Record<string, unknown> {
    const wrappedAccounts = Array.isArray(auth.accounts) ? auth.accounts : undefined;
    if (wrappedAccounts) {
      if (wrappedAccounts.length !== 1 || !this.objectValue(wrappedAccounts[0])) {
        throw new BadRequestException(
          'Use compatible JSON import when the file contains multiple accounts',
        );
      }
      return this.normalizeSystemAccountAuth(this.objectValue(wrappedAccounts[0])!);
    }
    if (auth.platform !== 'openai' || auth.type !== 'oauth') return auth;
    const credentials = this.objectValue(auth.credentials);
    if (!credentials) return auth;
    const authMode = this.stringValue(credentials.auth_mode);
    if (authMode?.toLowerCase() === 'agentidentity') {
      const agentIdentity: Record<string, unknown> = {};
      for (const key of [
        'agent_runtime_id',
        'agent_private_key',
        'account_id',
        'chatgpt_user_id',
        'task_id',
        'email',
        'plan_type',
      ]) {
        const value = this.stringValue(credentials[key]);
        if (value) agentIdentity[key] = value;
      }
      agentIdentity.chatgpt_account_is_fedramp = credentials.chatgpt_account_is_fedramp === true;
      return { auth_mode: 'agentIdentity', agent_identity: agentIdentity };
    }
    const accessToken = this.stringValue(credentials.access_token);
    if (!accessToken) return auth;
    const tokens: Record<string, unknown> = {
      access_token: accessToken,
      id_token: this.stringValue(credentials.id_token) ?? '',
      refresh_token: this.stringValue(credentials.refresh_token) ?? '',
    };
    for (const [source, target] of [
      ['chatgpt_account_id', 'account_id'],
      ['chatgpt_user_id', 'chatgpt_user_id'],
      ['email', 'email'],
      ['plan_type', 'plan_type'],
      ['organization_id', 'organization_id'],
      ['expires_at', 'expires_at'],
    ]) {
      const value = this.stringValue(credentials[source]);
      if (value) tokens[target] = value;
    }
    return {
      auth_mode: 'chatgpt',
      OPENAI_API_KEY: null,
      tokens,
      last_refresh: new Date().toISOString(),
    };
  }

  private hydratePersonalSystemAccountAuth(account: SyncedAccountEntity) {
    const auth = this.normalizeSystemAccountAuth(account.auth);
    const tokens = this.objectValue(auth.tokens);
    if (!tokens) return auth;

    const hydratedTokens: Record<string, unknown> = { ...tokens };
    if (!this.stringValue(hydratedTokens.email) && this.stringValue(account.email)) {
      hydratedTokens.email = account.email;
    }
    if (!this.stringValue(hydratedTokens.plan_type) && this.stringValue(account.plan)) {
      hydratedTokens.plan_type = account.plan;
    }
    if (
      !this.stringValue(hydratedTokens.account_id)
      && !this.stringValue(hydratedTokens.chatgpt_account_id)
      && this.stringValue(account.codexAccountId)
    ) {
      hydratedTokens.account_id = account.codexAccountId;
    }
    return { ...auth, tokens: hydratedTokens };
  }

  private withOfficialMetadataAccess<T extends { accounts: EffectiveSyncAccountDto[] }>(
    payload: T,
    canEditOfficialMetadata: boolean,
  ): T {
    return {
      ...payload,
      accounts: payload.accounts.map((account) => ({
        ...account,
        metadataEditable: account.official ? canEditOfficialMetadata : true,
      })),
    };
  }

  private async updateBoundSystemAccountMetadata(
    ownerId: string,
    incoming: SyncAccountDto,
    canEdit: boolean,
    rejectUnauthorizedChange: boolean,
  ) {
    const bindings = await this.loadSystemBindings(ownerId);
    const binding = bindings.find((item) => item.account.syncAccountId === incoming.id);
    if (!binding) return false;
    const changed = (binding.account.note ?? incoming.note) !== incoming.note
      || (binding.account.expiresAt ?? incoming.expiresAt) !== incoming.expiresAt;
    if (!changed) return false;
    if (!canEdit) {
      if (rejectUnauthorizedChange) {
        throw new ForbiddenException('You cannot edit official account notes or expiration dates');
      }
      return false;
    }
    await this.updateSystemAccount(binding.systemAccountId, {
      note: incoming.note,
      expiresAt: incoming.expiresAt,
    });
    return true;
  }

  private async upsertBoundAccountPrivateDetails(ownerId: string, incoming: SyncAccountDto) {
    if (!incoming.privateDetails) return;
    const incomingVersions = this.normalizeAccountFieldModifiedAt(
      incoming.fieldModifiedAt,
      incoming.lastModifiedAt,
    );
    const existing = await this.accounts.findOne({ where: { ownerId, accountId: incoming.id } });
    if (!existing) {
      const merged = this.mergeIncomingAccount(null, ownerId, incoming);
      if (merged) await this.accounts.save(this.accounts.create(merged.account));
      return;
    }
    const existingVersions = this.normalizeAccountFieldModifiedAt(
      existing.fieldModifiedAt,
      this.formatLastModifiedAt(existing.lastModifiedAt ?? existing.updatedAt),
    );
    if (!this.isIncomingFieldNewer(
      existingVersions.privateDetails,
      incomingVersions.privateDetails,
    )) return;
    existing.privateDetails = incoming.privateDetails;
    existingVersions.privateDetails = incomingVersions.privateDetails;
    existing.fieldModifiedAt = existingVersions;
    existing.lastModifiedAt = this.latestAccountFieldModifiedAt(existingVersions);
    existing.deletedAt = null;
    await this.accounts.save(existing);
  }

  private usageWindow(value: unknown): UsageWindowDto | null {
    const window = this.objectValue(value);
    const usedPercent = this.numberValue(window?.used_percent);
    if (usedPercent === undefined) return null;
    const used = Math.max(0, Math.min(100, usedPercent));
    const resetAt = this.numberValue(window?.reset_at);
    const windowSeconds = this.numberValue(window?.limit_window_seconds);
    return {
      usedPercent: used,
      remainingPercent: Math.max(0, Math.min(100, 100 - used)),
      resetsAt: resetAt ?? null,
      windowMinutes: windowSeconds && windowSeconds > 0
        ? Math.floor(windowSeconds / 60)
        : null,
    };
  }

  private promoExpiration(value: unknown) {
    if (value == null) return null;
    const timestamps: string[] = [];
    this.collectExpirationTimestamps(value, timestamps);
    timestamps.sort((left, right) => Date.parse(left) - Date.parse(right));
    return timestamps[0] ?? null;
  }

  private collectExpirationTimestamps(value: unknown, result: string[]) {
    if (Array.isArray(value)) {
      value.forEach((nested) => this.collectExpirationTimestamps(nested, result));
      return;
    }
    const object = this.objectValue(value);
    if (!object) return;
    for (const [key, nested] of Object.entries(object)) {
      const normalized = key.toLowerCase().replace(/-/g, '_');
      const compact = normalized.replace(/_/g, '');
      if (
        normalized.includes('expir')
        || compact.endsWith('until')
        || compact.endsWith('end')
        || compact.endsWith('endat')
        || compact.endsWith('endsat')
        || compact.endsWith('enddate')
        || compact.endsWith('endson')
      ) {
        const timestamp = this.normalizedResetCreditTimestamp(nested);
        if (timestamp) result.push(timestamp);
      }
      this.collectExpirationTimestamps(nested, result);
    }
  }

  private objectValue(value: unknown): Record<string, unknown> | undefined {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, unknown>
      : undefined;
  }

  private stringValue(value: unknown) {
    return typeof value === 'string' && value.length ? value : undefined;
  }

  private numberValue(value: unknown) {
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
  }

  private async requireSystemAccounts(ids: string[], addedByUserId?: string) {
    const accounts = await this.systemAccounts.find({
      where: { id: In(ids), ...(addedByUserId ? { addedByUserId } : {}) },
    });
    if (accounts.length !== ids.length) throw new NotFoundException('Official account not found');
    return accounts;
  }

  private async invalidateAccountCaches(userIds: string[]) {
    const keys = [...new Set(userIds)].map((userId) => this.cacheKey(userId));
    if (keys.length) await this.redis.del(...keys);
  }

  private parseLastModifiedAt(value: string | undefined) {
    if (!value?.trim()) return new Date();
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
  }

  private shouldApplyIncoming(existing: SyncedAccountEntity | null, incomingLastModifiedAt: Date) {
    if (!existing) return true;
    const existingLastModifiedAt = this.existingLastModifiedAt(existing);
    return incomingLastModifiedAt > existingLastModifiedAt;
  }

  private existingLastModifiedAt(account: SyncedAccountEntity) {
    return this.parseDateOrEpoch(account.lastModifiedAt ?? account.updatedAt);
  }

  private parseDateOrEpoch(value: Date | string | undefined) {
    if (!value) return new Date(0);
    const parsed = value instanceof Date ? value : new Date(value);
    return Number.isNaN(parsed.getTime()) ? new Date(0) : parsed;
  }

  private formatLastModifiedAt(value: Date | string | undefined) {
    return this.parseDateOrEpoch(value).toISOString();
  }

  private async withDeviceActiveAccount<T extends {
    accounts: SyncAccountDto[];
    deletedAccountIds: string[];
  }>(ownerId: string, deviceId: string | undefined, payload: T): Promise<T> {
    if (!deviceId || !DEVICE_ID_PATTERN.test(deviceId)) return payload;
    const device = await this.remoteDevices.findOne({ where: { ownerId, deviceId } });
    if (!device) {
      return {
        ...payload,
        accounts: payload.accounts.map((account) => ({ ...account, active: false })),
      };
    }
    return {
      ...payload,
      accounts: payload.accounts.map((account) => ({
        ...account,
        active: account.id === device.activeAccountId,
      })),
    };
  }

  private async updateDeviceActiveAccount(
    ownerId: string,
    deviceId: string | undefined,
    accounts: SyncAccountDto[],
  ) {
    if (!deviceId || !DEVICE_ID_PATTERN.test(deviceId)) return;
    const activeAccount = accounts.find((account) => account.active);
    if (!activeAccount) return;
    await this.remoteDevices.update(
      { ownerId, deviceId },
      { activeAccountId: activeAccount.id, lastSeenAt: new Date() },
    );
  }

  private cacheKey(ownerId: string) {
    return `sync:accounts:${ownerId}`;
  }

  private providerCacheKey(ownerId: string) {
    return `sync:providers:${ownerId}`;
  }
}
