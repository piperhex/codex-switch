import { Module } from '@nestjs/common';
import { PermissionsGuard } from '@/common/guards/permissions.guard';

@Module({
  providers: [PermissionsGuard],
  exports: [PermissionsGuard],
})
export class RbacModule {}
