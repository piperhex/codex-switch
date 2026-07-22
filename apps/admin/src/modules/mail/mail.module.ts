import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RbacModule } from '@/common/rbac/rbac.module';
import { AdminAuditLogEntity } from '@/modules/admin/entities/admin-audit-log.entity';
import { JwtConfigModule } from '@/modules/jwt/jwt.module';
import { MailServiceEntity } from './entities/mail-service.entity';
import { MailController } from './mail.controller';
import { MailService } from './mail.service';

@Module({
  imports: [
    JwtConfigModule,
    RbacModule,
    TypeOrmModule.forFeature([MailServiceEntity, AdminAuditLogEntity]),
  ],
  controllers: [MailController],
  providers: [MailService],
  exports: [MailService],
})
export class MailModule {}
