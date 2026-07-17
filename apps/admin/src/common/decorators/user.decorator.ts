import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Permission } from '@/common/rbac/permissions';

export interface AuthUser {
  id: string;
  email: string;
  role: string;
  roleName?: string;
  permissions?: Permission[];
}

export const CurrentUser = createParamDecorator(
  (_: unknown, context: ExecutionContext): AuthUser => {
    return context.switchToHttp().getRequest<{ user: AuthUser }>().user;
  },
);
