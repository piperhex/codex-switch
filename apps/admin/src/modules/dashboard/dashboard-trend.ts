export const DASHBOARD_PLATFORMS = ['windows', 'macos', 'linux', 'android', 'ios'] as const;

export interface DatedCountRow {
  date: string;
  count: string;
}

export interface PlatformCountRow {
  name: string;
  count: string;
}

export interface InstallationTrendRow extends DatedCountRow {
  platform: string;
}

export function platformCounts(rows: PlatformCountRow[]) {
  const counts = new Map(rows.map((row) => [row.name, Number(row.count)]));
  return DASHBOARD_PLATFORMS.map((name) => ({ name, value: counts.get(name) ?? 0 }));
}

export function buildDashboardTrend(options: {
  start: Date;
  days: number;
  users: DatedCountRow[];
  installations: InstallationTrendRow[];
  totalInstallations: number;
}) {
  const usersByDate = new Map(options.users.map((row) => [row.date, Number(row.count)]));
  const installationsByDate = new Map<string, InstallationTrendRow[]>();
  for (const row of options.installations) {
    const rows = installationsByDate.get(row.date) ?? [];
    rows.push(row);
    installationsByDate.set(row.date, rows);
  }
  // Start with devices first seen before the selected range, so totals remain cumulative.
  let totalInstallations = options.totalInstallations
    - options.installations.reduce((sum, row) => sum + Number(row.count), 0);
  return Array.from({ length: options.days }, (_, index) => {
    const date = new Date(options.start);
    date.setUTCDate(date.getUTCDate() + index);
    const key = date.toISOString().slice(0, 10);
    const rows = installationsByDate.get(key) ?? [];
    const installations = rows.reduce((sum, row) => sum + Number(row.count), 0);
    totalInstallations += installations;
    return {
      date: key,
      users: usersByDate.get(key) ?? 0,
      installations,
      totalInstallations,
      platforms: platformCounts(rows.map((row) => ({ name: row.platform, count: row.count }))),
    };
  });
}
