import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PermissionsGuard } from '@/common/guards/permissions.guard';
import { RbacPermissionEntity } from '@/modules/rbac/entities/permission.entity';
import { RbacRoleEntity } from '@/modules/rbac/entities/role.entity';
import { RbacService } from '@/modules/rbac/rbac.service';

@Global()
@Module({
  imports: [TypeOrmModule.forFeature([RbacPermissionEntity, RbacRoleEntity])],
  providers: [PermissionsGuard, RbacService],
  exports: [PermissionsGuard, RbacService],
})
export class RbacModule {}
