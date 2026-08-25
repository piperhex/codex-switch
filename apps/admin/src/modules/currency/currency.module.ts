import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdminAuditLogEntity } from '@/modules/admin/entities/admin-audit-log.entity';
import { CurrencyController } from './currency.controller';
import { CurrencyService } from './currency.service';
import { CurrencySettingsEntity } from './entities/currency-settings.entity';

@Module({
  imports: [TypeOrmModule.forFeature([CurrencySettingsEntity, AdminAuditLogEntity])],
  controllers: [CurrencyController],
  providers: [CurrencyService],
})
export class CurrencyModule {}
