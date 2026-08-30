import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtConfigModule } from '@/modules/jwt/jwt.module';
import { RbacModule } from '@/common/rbac/rbac.module';
import { AdminAuditLogEntity } from '@/modules/admin/entities/admin-audit-log.entity';
import { AdminPromptPluginsController } from './admin-prompt-plugins.controller';
import { PromptPluginsController } from './prompt-plugins.controller';
import { PromptPluginItemEntity } from './entities/prompt-plugin-item.entity';
import { PromptPluginsService } from './prompt-plugins.service';

@Module({
  imports: [JwtConfigModule, RbacModule, TypeOrmModule.forFeature([PromptPluginItemEntity, AdminAuditLogEntity])],
  controllers: [PromptPluginsController, AdminPromptPluginsController],
  providers: [PromptPluginsService],
})
export class PromptPluginsModule {}
