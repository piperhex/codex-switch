import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { DASHBOARD_QUERIES } from './dashboard-queries';
import { buildDashboardTrend, platformCounts, InstallationTrendRow } from './dashboard-trend';

interface CountRow {
  count: string;
}

interface DatedCountRow extends CountRow {
  date: string;
}

interface NamedCountRow extends CountRow {
  name: string;
}

interface SummaryRow {
  totalUsers: string;
  activeUsers: string;
  dailyActiveUsers: string;
  newUsers: string;
  totalInstallations: string;
  newInstallations: string;
  officialAccounts: string;
  boundOfficialAccounts: string;
  totalBindings: string;
  pendingFeedback: string;
  repliedFeedback: string;
  pendingApprovals: string;
}

@Injectable()
export class DashboardService {
  constructor(private readonly dataSource: DataSource) {}

  async getOverview(days: 7 | 30 | 90 = 30) {
    const end = new Date();
    const endDate = this.utcDate(end);
    const start = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate()));
    start.setUTCDate(start.getUTCDate() - days + 1);

    const [summaryRows, userRows, installationRows, platformRows, planRows, dailyActiveRows] = await Promise.all([
      this.dataSource.query<SummaryRow[]>(DASHBOARD_QUERIES.SUMMARY, [start]),
      this.dataSource.query<DatedCountRow[]>(DASHBOARD_QUERIES.USERS, [start]),
      this.dataSource.query<InstallationTrendRow[]>(DASHBOARD_QUERIES.INSTALLATIONS, [start]),
      this.dataSource.query<NamedCountRow[]>(DASHBOARD_QUERIES.PLATFORMS),
      this.dataSource.query<NamedCountRow[]>(DASHBOARD_QUERIES.PLANS),
      this.dataSource.query<NamedCountRow[]>(DASHBOARD_QUERIES.DAILY_ACTIVE),
    ]);

    const summary = summaryRows[0] ?? {
      totalUsers: '0', activeUsers: '0', dailyActiveUsers: '0', newUsers: '0',
      totalInstallations: '0', newInstallations: '0', officialAccounts: '0',
      boundOfficialAccounts: '0', totalBindings: '0', pendingFeedback: '0',
      repliedFeedback: '0', pendingApprovals: '0',
    };
    const trend = buildDashboardTrend({
      start, days, users: userRows, installations: installationRows,
      totalInstallations: Number(summary.totalInstallations),
    });

    return {
      range: { days, startDate: this.utcDate(start), endDate },
      summary: Object.fromEntries(
        Object.entries(summary).map(([key, value]) => [key, Number(value)]),
      ),
      trend,
      dailyActivePlatforms: platformCounts(dailyActiveRows),
      platforms: platformCounts(platformRows),
      accountPlans: planRows.map((row) => ({ name: row.name, value: Number(row.count) })),
      feedback: {
        pending: Number(summary.pendingFeedback),
        replied: Number(summary.repliedFeedback),
      },
    };
  }

  private utcDate(value: Date) {
    return value.toISOString().slice(0, 10);
  }
}
