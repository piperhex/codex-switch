import { useEffect, useMemo, useState } from 'react';
import * as Clipboard from 'expo-clipboard';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { AccountSummary } from '../types';
import { generateTotp, normalizeTotpSecret } from '../totp/totp';
import { BottomSheet } from './BottomSheet';
import { Toast } from './AppToast';

const TOTP_PERIOD_SECONDS = 30;

interface PrivateValueRowProps {
  hidden?: boolean;
  label: string;
  onToggle?: () => void;
  value: string;
}

function displaySecret(value: string, hidden: boolean) {
  if (!value) return '未设置';
  return hidden ? '••••••••••••' : value;
}

async function copyValue(label: string, value: string) {
  if (!value) return;
  try {
    await Clipboard.setStringAsync(value);
    Toast.success(`已复制${label}`);
  } catch {
    Toast.fail('复制失败，请重试');
  }
}

function PrivateValueRow({ hidden = false, label, onToggle, value }: PrivateValueRowProps) {
  return <View style={styles.valueRow}>
    <View style={styles.valueCopy}>
      <Text style={styles.valueLabel}>{label}</Text>
      <Text selectable={!hidden} style={[styles.valueText, !value && styles.emptyText]} numberOfLines={2}>
        {displaySecret(value, hidden)}
      </Text>
    </View>
    {onToggle && value ? <Pressable accessibilityRole="button" accessibilityLabel={`${hidden ? '显示' : '隐藏'}${label}`}
      onPress={onToggle} style={({ pressed }) => [styles.textButton, pressed && styles.pressed]}>
      <Text style={styles.textButtonLabel}>{hidden ? '显示' : '隐藏'}</Text>
    </Pressable> : null}
    <Pressable accessibilityRole="button" accessibilityLabel={`复制${label}`} disabled={!value}
      onPress={() => void copyValue(label, value)}
      style={({ pressed }) => [styles.copyButton, pressed && styles.pressed, !value && styles.disabled]}>
      <Text style={styles.copyButtonLabel}>复制</Text>
    </Pressable>
  </View>;
}

function useAccountTotp(secret: string) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!secret) return undefined;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [secret]);

  return useMemo(() => {
    try {
      const normalizedSecret = normalizeTotpSecret(secret);
      const code = generateTotp({
        id: 'account-preview',
        issuer: 'ChatGPT',
        accountName: '',
        secret: normalizedSecret,
        algorithm: 'SHA1',
        digits: 6,
        period: TOTP_PERIOD_SECONDS,
        createdAt: '',
      }, now);
      const elapsed = Math.floor(now / 1_000) % TOTP_PERIOD_SECONDS;
      return { code, remaining: TOTP_PERIOD_SECONDS - elapsed };
    } catch {
      return null;
    }
  }, [now, secret]);
}

function AccountTotpPreview({ secret }: { secret: string }) {
  const totp = useAccountTotp(secret);
  if (!secret) return null;
  if (!totp) return <Text style={styles.invalidTotp}>2FA 密钥格式不正确</Text>;
  const formattedCode = `${totp.code.slice(0, 3)} ${totp.code.slice(3)}`;
  return <Pressable accessibilityRole="button" accessibilityLabel="复制当前验证码"
    onPress={() => void copyValue('验证码', totp.code)}
    style={({ pressed }) => [styles.totpPreview, pressed && styles.pressed]}>
    <View>
      <Text style={styles.totpCaption}>当前验证码 · 点击复制</Text>
      <Text style={styles.totpCode}>{formattedCode}</Text>
    </View>
    <View style={styles.countdownBadge}>
      <Text style={styles.countdownText}>{totp.remaining}</Text>
    </View>
  </Pressable>;
}

export function AccountPrivateDetailsSheet({ account, onClose }: {
  account: AccountSummary | null;
  onClose: () => void;
}) {
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [totpSecretVisible, setTotpSecretVisible] = useState(false);
  const details = account?.privateDetails;

  useEffect(() => {
    setPasswordVisible(false);
    setTotpSecretVisible(false);
  }, [account?.id]);

  return <BottomSheet visible={Boolean(account)} tall title="账号资料" subtitle={account?.email}
    onClose={onClose} actions={[{ label: '完成', tone: 'primary', onPress: onClose }]}>
    <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
      <Text style={styles.sectionLabel}>备注</Text>
      <View style={styles.noteBox}>
        <Text selectable style={[styles.noteText, !account?.note && styles.emptyText]}>
          {account?.note || '该账号暂无备注'}
        </Text>
      </View>
      <Text style={styles.sectionLabel}>私密资料</Text>
      <View style={styles.privateCard}>
        <PrivateValueRow label="手机号" value={details?.phoneNumber ?? ''} />
        <View style={styles.divider} />
        <PrivateValueRow label="密码" value={details?.password ?? ''} hidden={!passwordVisible}
          onToggle={() => setPasswordVisible((visible) => !visible)} />
        <View style={styles.divider} />
        <PrivateValueRow label="2FA 密钥" value={details?.totpSecret ?? ''} hidden={!totpSecretVisible}
          onToggle={() => setTotpSecretVisible((visible) => !visible)} />
      </View>
      <AccountTotpPreview secret={details?.totpSecret ?? ''} />
    </ScrollView>
  </BottomSheet>;
}

const styles = StyleSheet.create({
  scroll: { maxHeight: 610 },
  content: { paddingBottom: 8 },
  sectionLabel: { color: '#6f8177', fontSize: 12, fontWeight: '800', marginBottom: 8, marginTop: 2 },
  noteBox: {
    minHeight: 88,
    padding: 14,
    borderWidth: 1,
    borderColor: '#dce8df',
    borderRadius: 13,
    backgroundColor: '#f8fbf9',
    marginBottom: 18,
  },
  noteText: { color: '#263b31', fontSize: 14, lineHeight: 21 },
  privateCard: { paddingHorizontal: 14, borderWidth: 1, borderColor: '#dce8df', borderRadius: 15 },
  valueRow: { minHeight: 74, flexDirection: 'row', alignItems: 'center', gap: 8 },
  valueCopy: { flex: 1, minWidth: 0 },
  valueLabel: { color: '#6f8177', fontSize: 11, fontWeight: '700', marginBottom: 5 },
  valueText: { color: '#13231c', fontSize: 14, fontWeight: '700', lineHeight: 19 },
  emptyText: { color: '#98a69f', fontWeight: '500' },
  textButton: { paddingHorizontal: 4, paddingVertical: 8 },
  textButtonLabel: { color: '#14806f', fontSize: 11, fontWeight: '800' },
  copyButton: { paddingHorizontal: 10, paddingVertical: 8, borderRadius: 8, backgroundColor: '#e6f8f1' },
  copyButtonLabel: { color: '#0b8065', fontSize: 11, fontWeight: '800' },
  divider: { height: 1, backgroundColor: '#edf2ee' },
  totpPreview: {
    minHeight: 86,
    marginTop: 12,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: '#bde8d8',
    borderRadius: 15,
    backgroundColor: '#eaf9f4',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  totpCaption: { color: '#568072', fontSize: 11, fontWeight: '700' },
  totpCode: { color: '#0b8065', fontSize: 27, fontWeight: '900', letterSpacing: 2, marginTop: 5 },
  countdownBadge: {
    width: 46,
    height: 46,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 3,
    borderColor: '#18af8c',
    borderRadius: 23,
    backgroundColor: '#fff',
  },
  countdownText: { color: '#0b8065', fontSize: 13, fontWeight: '900' },
  invalidTotp: { color: '#bd3c35', fontSize: 12, marginTop: 8 },
  pressed: { opacity: 0.72 },
  disabled: { opacity: 0.42 },
});
