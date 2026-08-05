import { SetMetadata } from '@nestjs/common';
import type { Permission } from '@/common/rbac/permissions';

export const REQUIRED_PERMISSIONS = 'required-permissions';
export const REQUIRED_ANY_PERMISSIONS = 'required-any-permissions';

export const RequirePermissions = (...permissions: Permission[]) => (
  SetMetadata(REQUIRED_PERMISSIONS, permissions)
);

export const RequireAnyPermissions = (...permissions: Permission[]) => (
  SetMetadata(REQUIRED_ANY_PERMISSIONS, permissions)
);
