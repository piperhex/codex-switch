import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { AuthUser } from '@/common/decorators/user.decorator';
import { REQUIRED_PERMISSIONS } from '@/common/decorators/permissions.decorator';
import { Permission } from '@/common/rbac/permissions';

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Permission[]>(REQUIRED_PERMISSIONS, [
      context.getHandler(),
      context.getClass(),
    ]) ?? [];
    if (!required.length) throw new ForbiddenException('Route permission is not configured');
    const user = context.switchToHttp().getRequest<{ user?: AuthUser }>().user;
    const granted = new Set(user?.permissions ?? []);
    if (user && required.every((permission) => granted.has(permission))) return true;
    throw new ForbiddenException('Insufficient permission');
  }
}
