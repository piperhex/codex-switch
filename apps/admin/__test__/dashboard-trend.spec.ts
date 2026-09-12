import { describe, expect, it } from 'vitest';
import { buildDashboardTrend, platformCounts } from '@/modules/dashboard/dashboard-trend';

describe('dashboard platform trends', () => {
  it.each([7, 30, 90])('keeps historical devices across an empty %i-day range', (days) => {
    const trend = buildDashboardTrend({
      start: new Date('2026-01-25T00:00:00Z'), days, users: [], installations: [], totalInstallations: 42,
    });
    expect(trend).toHaveLength(days);
    expect(trend.every((day) => day.totalInstallations === 42 && day.installations === 0)).toBe(true);
    expect(trend.every((day) => day.platforms.length === 5 && day.platforms.every((item) => item.value === 0)))
      .toBe(true);
  });

  it('accumulates multiple platforms across a UTC year boundary without counting users as devices', () => {
    const trend = buildDashboardTrend({
      start: new Date('2025-12-31T00:00:00Z'), days: 3, totalInstallations: 18,
      users: [{ date: '2026-01-01', count: '99' }],
      installations: [
        { date: '2026-01-02', platform: 'ios', count: '2' },
        { date: '2025-12-31', platform: 'linux', count: '3' },
        { date: '2025-12-31', platform: 'macos', count: '1' },
      ],
    });
    expect(trend.map(({ date, users, installations, totalInstallations }) => (
      { date, users, installations, totalInstallations }
    ))).toEqual([
      { date: '2025-12-31', users: 0, installations: 4, totalInstallations: 16 },
      { date: '2026-01-01', users: 99, installations: 0, totalInstallations: 16 },
      { date: '2026-01-02', users: 0, installations: 2, totalInstallations: 18 },
    ]);
    for (const day of trend) {
      expect(day.platforms.reduce((sum, item) => sum + item.value, 0)).toBe(day.installations);
    }
  });

  it('includes inactive platforms as zero counts', () => {
    expect(platformCounts([{ name: 'ios', count: '7' }])).toEqual([
      { name: 'windows', value: 0 }, { name: 'macos', value: 0 }, { name: 'linux', value: 0 },
      { name: 'android', value: 0 }, { name: 'ios', value: 7 },
    ]);
  });
});
