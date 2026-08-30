import type { Repository } from 'typeorm';
import { describe, expect, it, vi } from 'vitest';
import type { AuthUser } from '@/common/decorators/user.decorator';
import {
  MAX_PROMPT_PLUGIN_FILTER_TEXT,
  PromptPluginsService,
} from '@/modules/prompt-plugins/prompt-plugins.service';
import type { PromptPluginItemEntity } from '@/modules/prompt-plugins/entities/prompt-plugin-item.entity';
import type { AdminAuditLogEntity } from '@/modules/admin/entities/admin-audit-log.entity';

const actor: AuthUser = { id: 'publisher-1', email: 'publisher@example.com', role: 'user' };
const other: AuthUser = { id: 'publisher-2', email: 'other@example.com', role: 'user' };
const validDto = { name: 'Concise', version: '1.0.0', type: 'injection' as const, text: 'Be concise' };

function createService() {
  const repository = {
    create: vi.fn((value) => value),
    save: vi.fn(async (value) => ({
      ...value,
      id: value.id ?? 'prompt-1',
      installCount: value.installCount ?? 0,
      createdAt: value.createdAt ?? new Date('2026-08-30T01:00:00.000Z'),
      updatedAt: new Date('2026-08-30T01:00:00.000Z'),
    })),
    find: vi.fn(),
    findOne: vi.fn(),
    increment: vi.fn(),
    findAndCount: vi.fn(),
    delete: vi.fn(),
  };
  const auditLogs = {
    create: vi.fn((value) => value),
    save: vi.fn(async (value) => value),
  };
  return {
    service: new PromptPluginsService(
      repository as unknown as Repository<PromptPluginItemEntity>,
      auditLogs as unknown as Repository<AdminAuditLogEntity>,
    ),
    repository,
    auditLogs,
  };
}

describe('PromptPluginsService', () => {
  it('trims and persists an injection prompt', async () => {
    const { service, repository } = createService();
    await service.create(actor, { name: '  Concise  ', version: ' 1.0.0 ', type: 'injection', text: ' Be concise ' });
    expect(repository.create).toHaveBeenCalledWith(expect.objectContaining({
      name: 'Concise', version: '1.0.0', type: 'injection', text: 'Be concise', uploaderId: actor.id,
    }));
  });

  it('rejects filter text over 500 characters', async () => {
    const { service } = createService();
    await expect(service.create(actor, {
      name: 'x', version: '1.0.0', type: 'filter', text: 'x'.repeat(MAX_PROMPT_PLUGIN_FILTER_TEXT + 1),
    })).rejects.toThrow('500');
  });

  it('only lets the publisher update and increments installs', async () => {
    const { service, repository } = createService();
    repository.findOne.mockResolvedValue({ id: 'prompt-1', uploaderId: actor.id, version: '1.0.0' });
    await expect(service.update(other, 'prompt-1', validDto)).rejects.toThrow('publisher');
    repository.findOne.mockResolvedValue({
      id: 'prompt-1', uploaderId: actor.id, ...validDto, installCount: 2,
      createdAt: new Date('2026-08-30T01:00:00.000Z'), updatedAt: new Date('2026-08-30T01:00:00.000Z'),
    });
    await service.install('prompt-1');
    expect(repository.increment).toHaveBeenCalledWith({ id: 'prompt-1' }, 'installCount', 1);
  });

  it('lists prompt plugins for administrators with pagination and publisher details', async () => {
    const { service, repository } = createService();
    const item = {
      id: 'prompt-1',
      ...validDto,
      uploaderId: actor.id,
      uploaderEmail: actor.email,
      installCount: 12,
      createdAt: new Date('2026-08-30T01:00:00.000Z'),
      updatedAt: new Date('2026-08-30T02:00:00.000Z'),
    };
    repository.findAndCount.mockResolvedValue([[item], 1]);

    await expect(service.listForAdmin({ page: 2, pageSize: 10, search: 'Concise' })).resolves.toMatchObject({
      items: [{ id: 'prompt-1', uploaderEmail: actor.email, installCount: 12 }],
      total: 1,
      page: 2,
      pageSize: 10,
    });
    expect(repository.findAndCount).toHaveBeenCalled();
  });

  it('allows administrators to edit and delete prompt plugins with audit logs', async () => {
    const { service, repository, auditLogs } = createService();
    const item = {
      id: 'prompt-1',
      ...validDto,
      uploaderId: actor.id,
      uploaderEmail: actor.email,
      installCount: 3,
      createdAt: new Date('2026-08-30T01:00:00.000Z'),
      updatedAt: new Date('2026-08-30T02:00:00.000Z'),
    };
    repository.findOne.mockResolvedValue(item);
    repository.save.mockImplementation(async (value) => ({ ...value, updatedAt: new Date('2026-08-30T03:00:00.000Z') }));
    const admin: AuthUser = { id: 'admin-1', email: 'admin@example.com', role: 'admin' };

    await service.updateForAdmin(admin, 'prompt-1', {
      name: ' Curated prompt ', version: '2.0.0', type: 'filter', text: ' Remove secrets ',
    });
    expect(repository.save).toHaveBeenCalledWith(expect.objectContaining({
      name: 'Curated prompt', version: '2.0.0', type: 'filter', text: 'Remove secrets',
    }));
    expect(auditLogs.create).toHaveBeenCalledWith(expect.objectContaining({
      action: 'prompt-plugin.update', targetId: 'prompt-1',
    }));

    await expect(service.deleteForAdmin(admin, 'prompt-1')).resolves.toEqual({ ok: true });
    expect(repository.delete).toHaveBeenCalledWith({ id: 'prompt-1' });
    expect(auditLogs.create).toHaveBeenCalledWith(expect.objectContaining({
      action: 'prompt-plugin.delete', targetEmail: actor.email,
    }));
  });
});
