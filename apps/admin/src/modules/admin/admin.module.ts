import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SyncModule } from '@/modules/sync/sync.module';
import { UserModule } from '@/modules/user/user.module';
import { RbacModule } from '@/common/rbac/rbac.module';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { OfficialAccountOAuthService } from './official-account-oauth.service';
import { AdminApprovalRequestEntity } from './entities/admin-approval-request.entity';
import { AdminAuditLogEntity } from './entities/admin-audit-log.entity';
import { AdminInvitationEntity } from './entities/admin-invitation.entity';

@Module({
  imports: [
    UserModule,
    SyncModule,
    RbacModule,
    TypeOrmModule.forFeature([
      AdminApprovalRequestEntity,
      AdminAuditLogEntity,
      AdminInvitationEntity,
    ]),
  ],
  controllers: [AdminController],
  providers: [AdminService, OfficialAccountOAuthService],
  exports: [AdminService],
})
export class AdminModule {}
