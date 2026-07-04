import type { Response } from 'express';
import { describe, expect, it, vi } from 'vitest';
import { AdminController } from '@/modules/admin/admin.controller';
import { AuthController } from '@/modules/auth/auth.controller';
import { SyncController } from '@/modules/sync/sync.controller';
import type { AuthService } from '@/modules/auth/auth.service';
import type { SyncService } from '@/modules/sync/sync.service';
import type { UserService } from '@/modules/user/user.service';
import type { AuthUser } from '@/common/decorators/user.decorator';
import { makeAccount } from './fixtures';

describe('HTTP controllers', () => {
  it('AuthController forwards every endpoint argument and result', async () => {
    const auth = {
      register: vi.fn().mockResolvedValue('registered'),
      login: vi.fn().mockResolvedValue('logged-in'),
      refresh: vi.fn().mockResolvedValue('refreshed'),
      logout: vi.fn().mockResolvedValue({ ok: true }),
      me: vi.fn().mockResolvedValue('profile'),
    };
    const controller = new AuthController(auth as unknown as AuthService);

    await expect(controller.register({ email: 'a@example.com', password: 'password' }))
      .resolves.toBe('registered');
    await expect(controller.login({ email: 'a@example.com', password: 'secret' }))
      .resolves.toBe('logged-in');
    await expect(controller.refresh({ refreshToken: 'refresh' })).resolves.toBe('refreshed');
    await expect(controller.logout({ refreshToken: 'refresh' })).resolves.toEqual({ ok: true });
    const user: AuthUser = { id: 'user-1', email: 'a@example.com', role: 'user' };
    await expect(controller.me(user)).resolves.toBe('profile');

    expect(auth.register).toHaveBeenCalledWith('a@example.com', 'password');
    expect(auth.login).toHaveBeenCalledWith('a@example.com', 'secret');
    expect(auth.refresh).toHaveBeenCalledWith('refresh');
    expect(auth.logout).toHaveBeenCalledWith('refresh');
    expect(auth.me).toHaveBeenCalledWith('user-1');
  });

  it('SyncController scopes all operations to the authenticated user', async () => {
    const sync = {
      list: vi.fn().mockResolvedValue('list'), replace: vi.fn().mockResolvedValue('replace'),
      upsert: vi.fn().mockResolvedValue('upsert'), delete: vi.fn().mockResolvedValue('delete'),
    };
    const controller = new SyncController(sync as unknown as SyncService);
    const user: AuthUser = { id: 'owner-1', email: 'owner@example.com', role: 'user' };
    const account = makeAccount();

    await expect(controller.list(user)).resolves.toBe('list');
    await expect(controller.replace(user, { accounts: [account] })).resolves.toBe('replace');
    await expect(controller.upsert(user, account.id, account)).resolves.toBe('upsert');
    await expect(controller.delete(user, account.id)).resolves.toBe('delete');

    expect(sync.list).toHaveBeenCalledWith(user.id);
    expect(sync.replace).toHaveBeenCalledWith(user.id, { accounts: [account] });
    expect(sync.upsert).toHaveBeenCalledWith(user.id, account.id, account);
    expect(sync.delete).toHaveBeenCalledWith(user.id, account.id);
  });

  it('AdminController serves the page and delegates protected user management', async () => {
    const users = {
      listUsers: vi.fn().mockResolvedValue('users'), createUser: vi.fn().mockResolvedValue('created'),
      updateUser: vi.fn().mockResolvedValue('updated'),
    };
    const controller = new AdminController(users as unknown as UserService);
    const response = { sendFile: vi.fn().mockReturnValue('sent') };

    expect(controller.page(response as unknown as Response)).toBe('sent');
    expect(response.sendFile).toHaveBeenCalledWith(expect.stringMatching(/[\\/]public[\\/]admin\.html$/));
    await expect(controller.listUsers()).resolves.toBe('users');
    await expect(controller.createUser({ email: 'admin@example.com', password: 'password', role: 'admin' }))
      .resolves.toBe('created');
    await expect(controller.updateUser('user-1', { disabled: true })).resolves.toBe('updated');
    expect(users.createUser).toHaveBeenCalledWith({
      email: 'admin@example.com', password: 'password', role: 'admin',
    });
    expect(users.updateUser).toHaveBeenCalledWith('user-1', { disabled: true });
  });
});
