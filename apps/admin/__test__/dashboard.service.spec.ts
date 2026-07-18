import type { DataSource } from 'typeorm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DashboardController } from '@/modules/dashboard/dashboard.controller';
import { DashboardService } from '@/modules/dashboard/dashboard.service';

afterEach(() => {
  vi.useRealTimers();
});

describe('DashboardService', () => {
  it('combines operational totals and zero-fills the selected daily range', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-18T08:30:00.000Z'));
    const query = vi.fn()
      .mockResolvedValueOnce([{
        totalUsers: '12',
        activeUsers: '10',
        newUsers: '2',
        totalInstallations: '30',
        newInstallations: '5',
        officialAccounts: '8',
        boundOfficialAccounts: '6',
        totalBindings: '9',
        pendingFeedback: '3',
        repliedFeedback: '7',
        pendingApprovals: '1',
      }])
      .mockResolvedValueOnce([
        { date: '2026-07-12', count: '1' },
        { date: '2026-07-18', count: '1' },
      ])
      .mockResolvedValueOnce([{ date: '2026-07-17', count: '5' }])
      .mockResolvedValueOnce([
        { name: 'windows', count: '20' },
        { name: 'macos', count: '10' },
      ])
      .mockResolvedValueOnce([
        { name: 'Pro', count: '5' },
        { name: 'Team', count: '3' },
      ]);
    const service = new DashboardService({ query } as unknown as DataSource);

    const result = await service.getOverview(7);

    expect(result.range).toEqual({
      days: 7,
      startDate: '2026-07-12',
      endDate: '2026-07-18',
    });
    expect(result.summary).toMatchObject({
      totalUsers: 12,
      activeUsers: 10,
      totalInstallations: 30,
      pendingFeedback: 3,
    });
    expect(result.trend).toHaveLength(7);
    expect(result.trend[0]).toEqual({ date: '2026-07-12', users: 1, installations: 0 });
    expect(result.trend[5]).toEqual({ date: '2026-07-17', users: 0, installations: 5 });
    expect(result.platforms).toEqual([
      { name: 'windows', value: 20 },
      { name: 'macos', value: 10 },
      { name: 'linux', value: 0 },
      { name: 'android', value: 0 },
      { name: 'ios', value: 0 },
    ]);
    expect(result.feedback).toEqual({ pending: 3, replied: 7 });
    expect(query).toHaveBeenCalledTimes(5);
  });
});

describe('DashboardController', () => {
  it('delegates the selected period to the dashboard service', async () => {
    const dashboard = { getOverview: vi.fn().mockResolvedValue({ ok: true }) };
    const controller = new DashboardController(dashboard as unknown as DashboardService);

    await expect(controller.overview({ days: 90 })).resolves.toEqual({ ok: true });
    expect(dashboard.getOverview).toHaveBeenCalledWith(90);
  });
});
