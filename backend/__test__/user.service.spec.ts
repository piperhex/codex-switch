import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { Repository } from 'typeorm';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { UserService } from '@/modules/user/user.service';
import type { UserEntity } from '@/modules/user/entities/user.entity';
import { makeUser } from './fixtures';

describe('UserService', () => {
  let repository: {
    exists: ReturnType<typeof vi.fn>;
    count: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    save: ReturnType<typeof vi.fn>;
    findOne: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    find: ReturnType<typeof vi.fn>;
  };
  let service: UserService;

  beforeEach(() => {
    repository = {
      exists: vi.fn(), count: vi.fn(), create: vi.fn((value) => value),
      save: vi.fn(async (value) => value), findOne: vi.fn(), update: vi.fn(), find: vi.fn(),
    };
    service = new UserService(repository as unknown as Repository<UserEntity>);
  });

  it('normalizes email, hashes password and makes the first user an admin', async () => {
    repository.exists.mockResolvedValue(false);
    repository.count.mockResolvedValue(0);

    const user = await service.createUser({ email: '  First@Example.COM ', password: 'strong-pass' });

    expect(repository.exists).toHaveBeenCalledWith({ where: { email: 'first@example.com' } });
    expect(repository.create).toHaveBeenCalledWith(expect.objectContaining({
      email: 'first@example.com', role: 'admin', passwordHash: expect.any(String),
    }));
    expect(user.passwordHash).not.toBe('strong-pass');
    await expect(service.validatePassword(user, 'strong-pass')).resolves.toBe(true);
  });

  it('honors an explicit role for subsequent users', async () => {
    repository.exists.mockResolvedValue(false);
    repository.count.mockResolvedValue(9);
    await service.createUser({ email: 'u@example.com', password: 'password', role: 'admin' });
    expect(repository.create).toHaveBeenCalledWith(expect.objectContaining({ role: 'admin' }));
  });

  it('defaults subsequent users to user role', async () => {
    repository.exists.mockResolvedValue(false);
    repository.count.mockResolvedValue(1);
    await service.createUser({ email: 'u@example.com', password: 'password' });
    expect(repository.create).toHaveBeenCalledWith(expect.objectContaining({ role: 'user' }));
  });

  it('rejects duplicate normalized email before hashing or saving', async () => {
    repository.exists.mockResolvedValue(true);
    await expect(service.createUser({ email: ' DUP@example.com ', password: 'password' }))
      .rejects.toBeInstanceOf(BadRequestException);
    expect(repository.count).not.toHaveBeenCalled();
    expect(repository.save).not.toHaveBeenCalled();
  });

  it('queries credentials and active users with restrictive filters', async () => {
    await service.findByEmailWithPassword(' User@Example.COM ');
    expect(repository.findOne).toHaveBeenNthCalledWith(1, {
      where: { email: 'user@example.com' },
      select: ['id', 'email', 'passwordHash', 'role', 'disabled'],
    });
    await service.findActiveById('user-2');
    expect(repository.findOne).toHaveBeenNthCalledWith(2, { where: { id: 'user-2', disabled: false } });
  });

  it('marks login and lists newest users first', async () => {
    await service.markLogin('user-1');
    expect(repository.update).toHaveBeenCalledWith(
      { id: 'user-1' }, { lastLoginAt: expect.any(Date) },
    );
    await service.listUsers();
    expect(repository.find).toHaveBeenCalledWith({ order: { createdAt: 'DESC' } });
  });

  it('updates only supplied mutable fields', async () => {
    const user = makeUser();
    repository.findOne.mockResolvedValue(user);
    await expect(service.updateUser(user.id, { disabled: true, role: 'admin' }))
      .resolves.toMatchObject({ disabled: true, role: 'admin' });
    expect(repository.save).toHaveBeenCalledWith(user);

    const unchanged = makeUser({ id: 'user-2' });
    repository.findOne.mockResolvedValue(unchanged);
    await service.updateUser(unchanged.id, {});
    expect(unchanged).toMatchObject({ disabled: false, role: 'user' });
  });

  it('throws when updating an unknown user', async () => {
    repository.findOne.mockResolvedValue(null);
    await expect(service.updateUser('missing', { disabled: true }))
      .rejects.toBeInstanceOf(NotFoundException);
  });
});
