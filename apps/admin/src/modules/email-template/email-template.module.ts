import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RbacModule } from '@/common/rbac/rbac.module';
import { AdminAuditLogEntity } from '@/modules/admin/entities/admin-audit-log.entity';
import { JwtConfigModule } from '@/modules/jwt/jwt.module';
import { MailModule } from '@/modules/mail/mail.module';
import { EmailTemplateController } from './email-template.controller';
import { EmailTemplateService } from './email-template.service';
import { EmailTemplateEntity } from './entities/email-template.entity';

@Module({
  imports: [
    JwtConfigModule,
    RbacModule,
    MailModule,
    TypeOrmModule.forFeature([EmailTemplateEntity, AdminAuditLogEntity]),
  ],
  controllers: [EmailTemplateController],
  providers: [EmailTemplateService],
  exports: [EmailTemplateService],
})
export class EmailTemplateModule {}
