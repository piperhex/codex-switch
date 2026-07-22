import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RbacModule } from '@/common/rbac/rbac.module';
import { AdminAuditLogEntity } from '@/modules/admin/entities/admin-audit-log.entity';
import { JwtConfigModule } from '@/modules/jwt/jwt.module';
import { MailModule } from '@/modules/mail/mail.module';
import { FeedbackAttachmentEntity } from './entities/feedback-attachment.entity';
import { FeedbackEntity } from './entities/feedback.entity';
import { FeedbackController } from './feedback.controller';
import { FeedbackService } from './feedback.service';

@Module({
  imports: [
    JwtConfigModule,
    RbacModule,
    MailModule,
    TypeOrmModule.forFeature([
      FeedbackEntity,
      FeedbackAttachmentEntity,
      AdminAuditLogEntity,
    ]),
  ],
  controllers: [FeedbackController],
  providers: [FeedbackService],
})
export class FeedbackModule {}
