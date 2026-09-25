import { Ionicons } from '@expo/vector-icons';
import { Pressable, Text, View } from 'react-native';
import type { AccountSummary, UsageWindow } from '../types';
import { maskEmail, resetLabel } from './formatters';
import { accountColors as colors, styles } from './styles';

interface AccountCardProps {
  account: AccountSummary;
  privateMode: boolean;
  onOpenDetails: (account: AccountSummary) => void;
}

function planColors(plan: string) {
  switch (plan.trim().toLowerCase()) {
    case 'plus': return { ink: colors.blue, background: colors.paleBlue, fill: '#48b7ff' };
    case 'free': return { ink: colors.orange, background: colors.paleOrange, fill: '#2aceac' };
    default: return { ink: colors.green, background: colors.mint, fill: '#2aceac' };
  }
}

const CRITICAL_QUOTA_PERCENT = 15;
const LOW_QUOTA_PERCENT = 40;

function usageAppearance(remaining: number | null, plan: string) {
  const plus = plan.trim().toLowerCase() === 'plus';
  let fill = planColors(plan).fill;
  let textColor = plus ? colors.blue : colors.green;
  if (remaining !== null && remaining <= LOW_QUOTA_PERCENT) {
    fill = remaining <= CRITICAL_QUOTA_PERCENT ? colors.danger : colors.warning;
    textColor = fill;
  }
  const endColor = plus || (remaining !== null && remaining <= LOW_QUOTA_PERCENT) ? fill : '#63e7c7';
  return { fill, textColor, gradient: `linear-gradient(90deg, ${fill} 0%, ${endColor} 100%)` };
}

function AccountUsage({ usage, plan }: { usage?: UsageWindow | null; plan: string }) {
  const remaining = usage && Number.isFinite(usage.remainingPercent)
    ? Math.max(0, Math.min(100, Math.round(usage.remainingPercent))) : null;
  const { fill, textColor, gradient } = usageAppearance(remaining, plan);
  return <View style={styles.usage}>
    <View style={styles.meter}>
      <View style={styles.track} accessibilityRole="progressbar"
        accessibilityLabel="剩余额度" accessibilityValue={remaining === null
          ? { text: '用量暂不可用' } : { min: 0, max: 100, now: remaining }}>
        {remaining !== null ? <View style={[styles.fill, {
          width: `${remaining}%`, backgroundColor: fill,
          experimental_backgroundImage: gradient,
        }]} /> : null}
      </View>
      <Text style={[styles.remaining, { color: remaining === null ? colors.muted : textColor }]}>
        {remaining === null ? '--' : `${remaining}%`}
      </Text>
    </View>
    <View style={styles.reset}>
      <Ionicons name="time-outline" size={15} color={colors.muted} />
      <Text style={styles.resetText}>{remaining === null ? '用量暂不可用' : resetLabel(usage?.resetsAt)}</Text>
    </View>
  </View>;
}

export function AccountCard({ account, privateMode, onOpenDetails }: AccountCardProps) {
  const email = privateMode ? maskEmail(account.email) : account.email;
  const plan = account.plan || 'ChatGPT';
  const accent = planColors(plan);
  return <Pressable accessibilityRole="button" accessibilityLabel={`${email} 的账号信息`}
    accessibilityHint="打开完整账号信息" onPress={() => onOpenDetails(account)}
    style={({ pressed }) => [styles.card, pressed && styles.pressed]}>
    <View style={styles.cardContent}>
      <View style={styles.identity}>
        <View style={[styles.badge, { backgroundColor: accent.background }]}>
          <Text style={[styles.plan, { color: accent.ink }]} numberOfLines={1}>{plan}</Text>
        </View>
        <Text style={styles.email} numberOfLines={1}>{email}</Text>
      </View>
      <AccountUsage usage={account.usage.primary} plan={plan} />
    </View>
  </Pressable>;
}
