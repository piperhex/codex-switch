import { t, useLanguage } from '../i18n';
import { Ionicons } from '@expo/vector-icons';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import type { UsageSummary, UsageWindow } from '../types';
import { detailColors as colors, detailStyles as styles } from './detailStyles';
import { displayDate, resetLabel } from './formatters';

export type UsageHelp = 'primary' | 'secondary';

function UsageMeter({ title, usage, secondary, onHelp }: {
  title: string; usage?: UsageWindow | null; secondary: boolean; onHelp: () => void;
}) {
  useLanguage();
  const remaining = usage && Number.isFinite(usage.remainingPercent)
    ? Math.max(0, Math.min(100, Math.round(usage.remainingPercent))) : null;
  let color = secondary ? colors.blue : colors.green;
  if (remaining !== null && remaining <= 15) color = colors.danger;
  else if (remaining !== null && remaining <= 40) color = colors.warning;
  return <View style={styles.meter}>
    <View style={styles.meterHeading}>
      <Text style={styles.meterTitle}>{title}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel={t("了解{value1}", { value1: title })} onPress={onHelp}
        style={styles.iconButton}>
        <Ionicons name="help-circle" size={15} color="#98a4af" />
      </Pressable>
      <View style={styles.spacer} />
      <Text style={[styles.remaining, { color }]}>{remaining === null ? '--' : `${remaining}%`}</Text>
      <Text style={styles.remainingUnit}>{t("剩余")}</Text>
    </View>
    <View style={styles.track} accessibilityRole="progressbar" accessibilityLabel={t("{value1}剩余额度", { value1: title })}
      accessibilityValue={remaining === null ? { text: t("暂不可用") } : { min: 0, max: 100, now: remaining }}>
      {remaining !== null ? <View style={[styles.fill, { width: `${remaining}%`, backgroundColor: color }]} /> : null}
    </View>
    <View style={styles.reset}>
      <Ionicons name="time-outline" size={14} color={colors.muted} />
      <Text style={styles.resetText}>{usage ? resetLabel(usage.resetsAt) : t("用量暂不可用")}</Text>
    </View>
  </View>;
}

export function AccountUsageSection({ usage, refreshing, onRefresh, onHelp }: {
  usage: UsageSummary; refreshing: boolean; onRefresh: () => void; onHelp: (window: UsageHelp) => void;
}) {
  useLanguage();
  return <View style={styles.section}>
    <View style={styles.heading}>
      <View style={styles.sectionIcon}><Ionicons name="stats-chart" size={17} color={colors.muted} /></View>
      <Text style={styles.title}>{t("使用情况")}</Text>
      <Text style={styles.updated}>{t("更新于")}{' '}{displayDate(usage.fetchedAt)}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel={t("刷新账号用量")} disabled={refreshing}
        onPress={onRefresh} style={[styles.iconButton, refreshing && styles.disabled]}>
        {refreshing ? <ActivityIndicator size="small" color={colors.green} />
          : <Ionicons name="sync" size={18} color={colors.muted} />}
      </Pressable>
    </View>
    <UsageMeter title={t("主用量窗口")} usage={usage.primary} secondary={false} onHelp={() => onHelp('primary')} />
    <UsageMeter title={t("次用量窗口")} usage={usage.secondary} secondary onHelp={() => onHelp('secondary')} />
    {usage.error ? <Text style={styles.error}>{t("用量更新失败，请稍后重试")}</Text> : null}
  </View>;
}
