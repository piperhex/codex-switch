import type { Repository } from 'typeorm';
import { describe, expect, it, vi } from 'vitest';
import type { AuthUser } from '@/common/decorators/user.decorator';
import {
  MAX_PROMPT_PLUGIN_FILTER_TEXT,
  PromptPluginsService,
} from '@/modules/prompt-plugins/prompt-plugins.service';
import type { PromptPluginItemEntity } from '@/modules/prompt-plugins/entities/prompt-plugin-item.entity';

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
  };
  return {
    service: new PromptPluginsService(repository as unknown as Repository<PromptPluginItemEntity>),
    repository,
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
});
