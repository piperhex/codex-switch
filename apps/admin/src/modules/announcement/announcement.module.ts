import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdminAuditLogEntity } from '@/modules/admin/entities/admin-audit-log.entity';
import { AnnouncementController } from './announcement.controller';
import { AnnouncementService } from './announcement.service';
import { AppAnnouncementEntity } from './entities/app-announcement.entity';

@Module({
  imports: [TypeOrmModule.forFeature([AppAnnouncementEntity, AdminAuditLogEntity])],
  controllers: [AnnouncementController],
  providers: [AnnouncementService],
})
export class AnnouncementModule {}
