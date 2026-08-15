import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RbacModule } from '@/common/rbac/rbac.module';
import { SyncedAccountEntity } from './entities/synced-account.entity';
import { SyncedProviderEntity } from './entities/synced-provider.entity';
import { SyncedTotpVaultEntity } from './entities/synced-totp-vault.entity';
import { SystemAccountBindingEntity } from './entities/system-account-binding.entity';
import { SystemAccountEntity } from './entities/system-account.entity';
import { SyncController } from './sync.controller';
import { SyncService } from './sync.service';
import { PersonalAccountOAuthService } from './personal-account-oauth.service';
import { RemoteDeviceEntity } from '@/modules/devices/entities/remote-device.entity';

@Module({
  imports: [
    RbacModule,
    TypeOrmModule.forFeature([
      SyncedAccountEntity,
      SyncedProviderEntity,
      SyncedTotpVaultEntity,
      SystemAccountEntity,
      SystemAccountBindingEntity,
      RemoteDeviceEntity,
    ]),
  ],
  controllers: [SyncController],
  providers: [SyncService, PersonalAccountOAuthService],
  exports: [SyncService],
})
export class SyncModule {}
