import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

const PLATFORMS = ['windows', 'macos', 'linux', 'android', 'ios'] as const;

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

    const [summaryRows, userRows, installationRows, platformRows, planRows] = await Promise.all([
      this.dataSource.query<SummaryRow[]>(`
        SELECT
          (SELECT COUNT(*) FROM users)::text AS "totalUsers",
          (SELECT COUNT(*) FROM users WHERE disabled = false)::text AS "activeUsers",
          (SELECT COUNT(*) FROM users WHERE "createdAt" >= $1)::text AS "newUsers",
          (SELECT COUNT(*) FROM device_installations)::text AS "totalInstallations",
          (SELECT COUNT(*) FROM device_installations WHERE "firstSeenAt" >= $1)::text AS "newInstallations",
          (SELECT COUNT(*) FROM system_accounts)::text AS "officialAccounts",
          (SELECT COUNT(DISTINCT "systemAccountId") FROM system_account_bindings)::text AS "boundOfficialAccounts",
          (SELECT COUNT(*) FROM system_account_bindings)::text AS "totalBindings",
          (SELECT COUNT(*) FROM user_feedback WHERE "lastRepliedAt" IS NULL)::text AS "pendingFeedback",
          (SELECT COUNT(*) FROM user_feedback WHERE "lastRepliedAt" IS NOT NULL)::text AS "repliedFeedback",
          (SELECT COUNT(*) FROM admin_approval_requests WHERE status = 'pending')::text AS "pendingApprovals"
      `, [start]),
      this.dataSource.query<DatedCountRow[]>(`
        SELECT TO_CHAR(("createdAt" AT TIME ZONE 'UTC')::date, 'YYYY-MM-DD') AS date,
               COUNT(*)::text AS count
        FROM users
        WHERE "createdAt" >= $1
        GROUP BY 1
        ORDER BY 1
      `, [start]),
      this.dataSource.query<DatedCountRow[]>(`
        SELECT TO_CHAR(("firstSeenAt" AT TIME ZONE 'UTC')::date, 'YYYY-MM-DD') AS date,
               COUNT(*)::text AS count
        FROM device_installations
        WHERE "firstSeenAt" >= $1
        GROUP BY 1
        ORDER BY 1
      `, [start]),
      this.dataSource.query<NamedCountRow[]>(`
        SELECT platform AS name, COUNT(*)::text AS count
        FROM device_installations
        GROUP BY platform
        ORDER BY COUNT(*) DESC
      `),
      this.dataSource.query<NamedCountRow[]>(`
        SELECT COALESCE(NULLIF(TRIM(plan), ''), 'Unknown') AS name,
               COUNT(*)::text AS count
        FROM system_accounts
        GROUP BY 1
        ORDER BY COUNT(*) DESC, name ASC
        LIMIT 8
      `),
    ]);

    const summary = summaryRows[0] ?? {
      totalUsers: '0', activeUsers: '0', newUsers: '0',
      totalInstallations: '0', newInstallations: '0', officialAccounts: '0',
      boundOfficialAccounts: '0', totalBindings: '0', pendingFeedback: '0',
      repliedFeedback: '0', pendingApprovals: '0',
    };
    const usersByDate = new Map(userRows.map((row) => [row.date, Number(row.count)]));
    const installationsByDate = new Map(
      installationRows.map((row) => [row.date, Number(row.count)]),
    );
    const trend = Array.from({ length: days }, (_, index) => {
      const date = new Date(start);
      date.setUTCDate(start.getUTCDate() + index);
      const key = this.utcDate(date);
      return {
        date: key,
        users: usersByDate.get(key) ?? 0,
        installations: installationsByDate.get(key) ?? 0,
      };
    });
    const platformCounts = new Map(platformRows.map((row) => [row.name, Number(row.count)]));

    return {
      range: { days, startDate: this.utcDate(start), endDate },
      summary: Object.fromEntries(
        Object.entries(summary).map(([key, value]) => [key, Number(value)]),
      ),
      trend,
      platforms: PLATFORMS.map((name) => ({ name, value: platformCounts.get(name) ?? 0 })),
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
