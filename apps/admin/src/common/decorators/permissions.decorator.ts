import { SetMetadata } from '@nestjs/common';
import type { Permission } from '@/common/rbac/permissions';

export const REQUIRED_PERMISSIONS = 'required-permissions';

export const RequirePermissions = (...permissions: Permission[]) => (
  SetMetadata(REQUIRED_PERMISSIONS, permissions)
);
