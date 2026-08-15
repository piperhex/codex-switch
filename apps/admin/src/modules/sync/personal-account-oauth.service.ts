import { Inject, Injectable } from '@nestjs/common';
import Redis from 'ioredis';
import type { AuthUser } from '@/common/decorators/user.decorator';
import { MODULE_OPTIONS_TOKEN } from '@/config/configurable';
import type { ConfigModuleOptions } from '@/config/config.types';
import { REDIS_CLIENT } from '@/modules/redis/redis.constants';
import { CodexDeviceOAuth } from './codex-device-oauth';
import { SyncService, type MobileSyncAccountDto } from './sync.service';

@Injectable()
export class PersonalAccountOAuthService extends CodexDeviceOAuth<MobileSyncAccountDto> {
  constructor(
    @Inject(MODULE_OPTIONS_TOKEN) config: ConfigModuleOptions,
    @Inject(REDIS_CLIENT) redis: Redis,
    private readonly sync: SyncService,
  ) {
    super(config, redis, 'sync:personal-account-oauth', 'user');
  }

  poll(actor: AuthUser, sessionId: string) {
    return this.pollWith(
      actor,
      sessionId,
      (auth) => this.sync.upsertPersonalAccountFromAuth(actor.id, auth),
    );
  }
}
