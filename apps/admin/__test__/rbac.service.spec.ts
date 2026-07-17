import { BadRequestException, ForbiddenException } from '@nestjs/common';
import type { DataSource, Repository } from 'typeorm';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthUser } from '@/common/decorators/user.decorator';
import {
  PERMISSION_CATALOG,
  Permission,
  USER_ROLE_PERMISSIONS,
} from '@/common/rbac/permissions';
import type { RbacPermissionEntity } from '@/modules/rbac/entities/permission.entity';
import type { RbacRoleEntity } from '@/modules/rbac/entities/role.entity';
import { RbacService } from '@/modules/rbac/rbac.service';

const permissionRow = (code: Permission): RbacPermissionEntity => {
  const definition = PERMISSION_CATALOG.find((permission) => permission.code === code)!;
  return { ...definition };
};

const roleRow = (overrides: Partial<RbacRoleEntity> = {}): RbacRoleEntity => ({
  code: 'support',
  name: 'Support',
  description: '',
  system: false,
  permissions: [permissionRow(Permission.UsersRead)],
  createdAt: new Date('2026-07-18T00:00:00.000Z'),
  updatedAt: new Date('2026-07-18T00:00:00.000Z'),
  ...overrides,
});

describe('RbacService', () => {
  let permissions: {
    upsert: ReturnType<typeof vi.fn>;
    find: ReturnType<typeof vi.fn>;
  };
  let roles: {
    find: ReturnType<typeof vi.fn>;
    findOne: ReturnType<typeof vi.fn>;
    exists: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    save: ReturnType<typeof vi.fn>;
    remove: ReturnType<typeof vi.fn>;
  };
  let dataSource: { query: ReturnType<typeof vi.fn> };
  let service: RbacService;
  const admin: AuthUser = { id: 'admin-1', email: 'admin@example.com', role: 'admin' };

  beforeEach(() => {
    permissions = {
      upsert: vi.fn(),
      find: vi.fn(),
    };
    roles = {
      find: vi.fn(),
      findOne: vi.fn(),
      exists: vi.fn(),
      create: vi.fn((value) => value),
      save: vi.fn(async (value) => value),
      remove: vi.fn(async (value) => value),
    };
    dataSource = { query: vi.fn() };
    service = new RbacService(
      permissions as unknown as Repository<RbacPermissionEntity>,
      roles as unknown as Repository<RbacRoleEntity>,
      dataSource as unknown as DataSource,
    );
  });

  it('seeds the permission catalog and synchronizes protected system roles', async () => {
    permissions.find
      .mockResolvedValueOnce(USER_ROLE_PERMISSIONS.map(permissionRow))
      .mockResolvedValueOnce(PERMISSION_CATALOG.map(({ code }) => permissionRow(code)));
    roles.findOne.mockResolvedValue(null);

    await service.synchronizeCatalog();

    expect(permissions.upsert).toHaveBeenCalledWith(
      PERMISSION_CATALOG.map((permission) => ({ ...permission })),
      ['code'],
    );
    expect(roles.save).toHaveBeenNthCalledWith(1, expect.objectContaining({
      code: 'user', system: true, permissions: expect.arrayContaining(USER_ROLE_PERMISSIONS.map(permissionRow)),
    }));
    expect(roles.save).toHaveBeenNthCalledWith(2, expect.objectContaining({
      code: 'admin', system: true,
    }));
  });

  it('creates a custom role with catalog permissions', async () => {
    roles.exists.mockResolvedValue(false);
    permissions.find.mockResolvedValue([
      permissionRow(Permission.UsersRead),
      permissionRow(Permission.FeedbackRead),
    ]);

    const result = await service.createRole(admin, {
      code: 'support',
      name: 'Support',
      description: 'Read-only support staff',
      permissions: [Permission.UsersRead, Permission.FeedbackRead],
    });

    expect(result).toEqual(expect.objectContaining({
      code: 'support',
      name: 'Support',
      system: false,
      permissions: [Permission.FeedbackRead, Permission.UsersRead],
    }));
  });

  it('prevents a delegated role manager from granting permissions they do not hold', async () => {
    const manager: AuthUser = {
      id: 'manager-1',
      email: 'manager@example.com',
      role: 'role-manager',
      permissions: [Permission.RolesManage],
    };
    roles.exists.mockResolvedValue(false);
    permissions.find.mockResolvedValue([
      permissionRow(Permission.UsersManage),
      permissionRow(Permission.UsersRead),
      permissionRow(Permission.RolesRead),
    ]);

    await expect(service.createRole(manager, {
      code: 'user-manager',
      name: 'User manager',
      permissions: [Permission.UsersManage],
    })).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('protects built-in roles and refuses to delete assigned custom roles', async () => {
    roles.findOne.mockResolvedValueOnce(roleRow({ code: 'admin', system: true }));
    await expect(service.updateRole(admin, 'admin', { name: 'Root' }))
      .rejects.toBeInstanceOf(BadRequestException);

    roles.findOne.mockResolvedValueOnce(roleRow());
    dataSource.query.mockResolvedValue([{ count: '1' }]);
    await expect(service.deleteRole('support')).rejects.toThrow('Role is assigned');
    expect(roles.remove).not.toHaveBeenCalled();
  });

  it('returns current database permissions for authentication', async () => {
    roles.findOne.mockResolvedValue(roleRow({
      name: 'Auditor',
      permissions: [permissionRow(Permission.AuditLogsRead)],
    }));
    await expect(service.accessForRole('auditor')).resolves.toEqual({
      roleName: 'Auditor',
      permissions: [Permission.AuditLogsRead],
    });
  });
});
