import { StyleSheet, Text, View } from 'react-native';
import type { AdminDashboardOverview } from '../types';

const PLATFORMS = [
  { name: 'windows', label: 'Windows', color: '#1769e0' },
  { name: 'macos', label: 'macOS', color: '#7c3aed' },
  { name: 'linux', label: 'Linux', color: '#f59e0b' },
  { name: 'android', label: 'Android', color: '#16a085' },
  { name: 'ios', label: 'iOS', color: '#06b6d4' },
];
const MAX_TREND_DAYS = 10;
type PlatformCounts = AdminDashboardOverview['dailyActivePlatforms'];

export function DailyActivePlatforms({ counts }: { counts?: PlatformCounts }) {
  return <View style={styles.platforms}>
    {PLATFORMS.map((platform) => <Text key={platform.name} style={styles.platformCount}>
      {platform.label} {counts?.find((item) => item.name === platform.name)?.value ?? 0}
    </Text>)}
  </View>;
}

export function DashboardGrowth({ data }: { data: AdminDashboardOverview | null }) {
  const trend = data?.trend.slice(-MAX_TREND_DAYS) ?? [];
  const maximum = Math.max(1, ...trend.map((item) => item.installations));
  return <View style={styles.growth}>
    <Text style={styles.subtitle}>最近 {trend.length || MAX_TREND_DAYS} 天 · 总设备 {data?.summary.totalInstallations ?? 0}</Text>
    <View style={styles.platforms}>
      {PLATFORMS.map((platform) => <View key={platform.name} style={styles.legend}>
        <View style={[styles.dot, { backgroundColor: platform.color }]} />
        <Text style={styles.platformCount}>{platform.label}</Text>
      </View>)}
    </View>
    {trend.length ? trend.map((item) => <View key={item.date} style={styles.day}>
      <View style={styles.heading}>
        <Text style={styles.date}>{item.date.slice(5)}</Text>
        <Text style={styles.total}>总设备 {item.totalInstallations ?? '—'}</Text>
      </View>
      <Text style={styles.subtitle}>新增用户 {item.users} · 新增设备 {item.installations}</Text>
      <View style={styles.track}>
        {PLATFORMS.map((platform) => <View key={platform.name} style={{
          height: '100%', backgroundColor: platform.color,
          width: `${((item.platforms?.find((entry) => entry.name === platform.name)?.value ?? 0) / maximum) * 100}%`,
        }} />)}
      </View>
      <DailyActivePlatforms counts={item.platforms} />
    </View>) : <Text style={styles.subtitle}>暂无趋势数据</Text>}
  </View>;
}

const styles = StyleSheet.create({
  growth: { gap: 10 },
  platforms: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 6 },
  platformCount: { color: '#6d7c75', fontSize: 11, fontVariant: ['tabular-nums'] },
  legend: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  dot: { width: 7, height: 7, borderRadius: 4 },
  subtitle: { color: '#6d7c75', fontSize: 11, flexShrink: 1 },
  day: { paddingVertical: 8, gap: 5 },
  heading: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: 8 },
  date: { color: '#10251d', fontSize: 12, fontWeight: '700' },
  total: { color: '#10251d', fontSize: 11, fontWeight: '600' },
  track: { height: 7, flexDirection: 'row', backgroundColor: '#e0e8e3', borderRadius: 4, overflow: 'hidden' },
});
