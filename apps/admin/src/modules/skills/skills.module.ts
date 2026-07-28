import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RbacModule } from '@/common/rbac/rbac.module';
import { AdminAuditLogEntity } from '@/modules/admin/entities/admin-audit-log.entity';
import { JwtConfigModule } from '@/modules/jwt/jwt.module';
import { AdminSkillsController } from './admin-skills.controller';
import { SkillMarketItemEntity } from './entities/skill-market-item.entity';
import { SkillsController } from './skills.controller';
import { SkillsService } from './skills.service';

@Module({
  imports: [
    JwtConfigModule,
    RbacModule,
    TypeOrmModule.forFeature([SkillMarketItemEntity, AdminAuditLogEntity]),
  ],
  controllers: [SkillsController, AdminSkillsController],
  providers: [SkillsService],
})
export class SkillsModule {}
