import { ForbiddenException, UnauthorizedException, type ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import { describe, expect, it, vi } from 'vitest';
import { PermissionsGuard } from '@/common/guards/permissions.guard';
import {
  REQUIRED_ANY_PERMISSIONS,
  REQUIRED_PERMISSIONS,
} from '@/common/decorators/permissions.decorator';
import {
  Permission,
  USER_ROLE_PERMISSIONS,
  expandPermissionDependencies,
} from '@/common/rbac/permissions';
import { JwtStrategy } from '@/modules/jwt/jwt.strategy';
import { AdminController } from '@/modules/admin/admin.controller';
import type { UserService } from '@/modules/user/user.service';
import type { AuthUser } from '@/common/decorators/user.decorator';
import type { RbacService } from '@/modules/rbac/rbac.service';
import { makeUser } from './fixtures';

function contextWithUser(user?: AuthUser): ExecutionContext {
  return {
    getHandler: () => contextWithUser,
    getClass: () => Object,
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as unknown as ExecutionContext;
}

describe('authorization boundaries', () => {
  it('PermissionsGuard allows role grants and rejects missing admin grants', () => {
    const reflector = {
      getAllAndOverride: vi.fn().mockReturnValue([Permission.SelfAccountsRead]),
    };
    const guard = new PermissionsGuard(reflector as unknown as Reflector);
    const user: AuthUser = {
      id: 'user-1', email: 'user@example.com', role: 'user', permissions: [...USER_ROLE_PERMISSIONS],
    };
    const admin: AuthUser = {
      id: 'admin-1', email: 'admin@example.com', role: 'admin', permissions: Object.values(Permission),
    };

    expect(guard.canActivate(contextWithUser(user))).toBe(true);
    expect(guard.canActivate(contextWithUser(admin))).toBe(true);

    reflector.getAllAndOverride.mockReturnValue([Permission.UsersManage]);
    expect(() => guard.canActivate(contextWithUser(user))).toThrow(ForbiddenException);
    expect(guard.canActivate(contextWithUser(admin))).toBe(true);
    expect(() => guard.canActivate(contextWithUser())).toThrow('Insufficient permission');

    reflector.getAllAndOverride.mockReturnValue([]);
    expect(() => guard.canActivate(contextWithUser(admin)))
      .toThrow('Route permission is not configured');
  });

  it('keeps the built-in user permission seed limited to self service', () => {
    expect(USER_ROLE_PERMISSIONS).toEqual([
      Permission.SelfAccountsRead,
      Permission.SelfAccountsWrite,
      Permission.SelfProvidersRead,
      Permission.SelfProvidersWrite,
      Permission.SelfPasswordUpdate,
    ]);
    expect(USER_ROLE_PERMISSIONS).not.toContain(Permission.UsersRead);
    expect(USER_ROLE_PERMISSIONS).not.toContain(Permission.TelemetryRead);
    expect(USER_ROLE_PERMISSIONS).not.toContain(Permission.OfficialAccountMetadataWrite);
  });

  it('allows routes configured with any one of multiple read permissions', () => {
    const reflector = {
      getAllAndOverride: vi.fn((key: string) => (
        key === REQUIRED_PERMISSIONS
          ? []
          : [Permission.OfficialAccountsRead, Permission.OfficialAccountsReadOwn]
      )),
    };
    const guard = new PermissionsGuard(reflector as unknown as Reflector);
    const ownReader: AuthUser = {
      id: 'user-1',
      email: 'user@example.com',
      role: 'pool-reader',
      permissions: [Permission.OfficialAccountsReadOwn],
    };

    expect(guard.canActivate(contextWithUser(ownReader))).toBe(true);
    expect(reflector.getAllAndOverride).toHaveBeenCalledWith(
      REQUIRED_ANY_PERMISSIONS,
      expect.any(Array),
    );
  });

  it('keeps synchronized user data unavailable to user-list-only roles', () => {
    for (const method of ['listUserAccounts', 'listUserProviders'] as const) {
      const handler = AdminController.prototype[method];

      expect(Reflect.getMetadata(REQUIRED_PERMISSIONS, handler)).toEqual([
        Permission.UsersRead,
      ]);
      expect(Reflect.getMetadata(REQUIRED_ANY_PERMISSIONS, handler)).toEqual([
        Permission.UsersManage,
        Permission.OfficialAccountsManage,
        Permission.OfficialAccountsManageOwn,
      ]);
    }
  });

  it('requires official-pool management permission to record own accounts', () => {
    for (const method of ['addOwnAccountToSystemPool', 'addOwnAccountsToSystemPool'] as const) {
      const handler = AdminController.prototype[method];

      expect(Reflect.getMetadata(REQUIRED_PERMISSIONS, handler)).toBeUndefined();
      expect(Reflect.getMetadata(REQUIRED_ANY_PERMISSIONS, handler)).toEqual([
        Permission.OfficialAccountsManage,
        Permission.OfficialAccountsManageOwn,
      ]);
    }
  });

  it('expands own-account management into own-read and user-list access', () => {
    const permissions = expandPermissionDependencies([
      Permission.OfficialAccountsManageOwn,
    ]);

    expect(permissions).toEqual(expect.arrayContaining([
      Permission.OfficialAccountsManageOwn,
      Permission.OfficialAccountsReadOwn,
      Permission.UsersRead,
    ]));
    expect(permissions).not.toContain(Permission.OfficialAccountsRead);
    expect(permissions).not.toContain(Permission.OfficialAccountsManage);
  });

  it('JwtStrategy rehydrates identity from current database state', async () => {
    const user = makeUser({ email: 'current@example.com', role: 'admin' });
    const users = { findActiveById: vi.fn().mockResolvedValue(user) };
    const rbac = {
      accessForRole: vi.fn().mockResolvedValue({
        roleName: 'Administrator', permissions: Object.values(Permission),
      }),
    };
    const strategy = new JwtStrategy(
      { KONG_JWT_SECRET: 'configured-secret' }, users as unknown as UserService,
      rbac as unknown as RbacService,
    );

    await expect(strategy.validate({
      sub: user.id, email: 'stale@example.com', role: 'user', iss: 'issuer',
    })).resolves.toEqual({
      id: user.id,
      email: user.email,
      role: user.role,
      roleName: 'Administrator',
      permissions: Object.values(Permission),
    });
    expect(users.findActiveById).toHaveBeenCalledWith(user.id);
  });

  it('JwtStrategy rejects deleted or disabled users', async () => {
    const users = { findActiveById: vi.fn().mockResolvedValue(null) };
    const rbac = { accessForRole: vi.fn() };
    const strategy = new JwtStrategy(
      {}, users as unknown as UserService, rbac as unknown as RbacService,
    );
    await expect(strategy.validate({
      sub: 'missing', email: 'old@example.com', role: 'user', iss: 'issuer',
    })).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
