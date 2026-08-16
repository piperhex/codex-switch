import { useEffect, useMemo, useState } from 'react';
import * as Clipboard from 'expo-clipboard';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { updateAccountDetails } from '../api/client';
import { generateTotp, normalizeTotpSecret, parseOtpAuthUri } from '../totp/totp';
import { TotpQrScanner } from '../totp/TotpQrScanner';
import type { AccountSummary, AuthSession } from '../types';
import { BottomSheet } from './BottomSheet';
import { Toast } from './AppToast';

const TOTP_PERIOD_SECONDS = 30;

function messageOf(error: unknown) {
  return error instanceof Error ? error.message : '保存失败，请稍后重试';
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

function normalizeAccountTotp(value: string) {
  if (!value.trim()) return '';
  return value.trim().toLowerCase().startsWith('otpauth://')
    ? parseOtpAuthUri(value).secret
    : normalizeTotpSecret(value);
}

function validExpirationDate(value: string) {
  if (!value) return true;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function SecretInputRow({ label, value, onChangeText, hidden, onToggle, maxLength }: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  hidden: boolean;
  onToggle: () => void;
  maxLength: number;
}) {
  return <View>
    <Text style={styles.label}>{label}</Text>
    <View style={styles.inputRow}>
      <TextInput value={value} onChangeText={onChangeText} secureTextEntry={hidden}
        autoCapitalize="none" autoCorrect={false} maxLength={maxLength}
        placeholder="未设置" placeholderTextColor="#98a69f" style={[styles.input, styles.flexInput]} />
      <Pressable accessibilityRole="button" onPress={onToggle} style={styles.textButton}>
        <Text style={styles.textButtonLabel}>{hidden ? '显示' : '隐藏'}</Text>
      </Pressable>
      <Pressable accessibilityRole="button" disabled={!value} onPress={() => void copyValue(label, value)}
        style={[styles.copyButton, !value && styles.disabled]}>
        <Text style={styles.copyButtonLabel}>复制</Text>
      </Pressable>
    </View>
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
    if (!secret) return null;
    try {
      const code = generateTotp({
        id: 'account-preview', issuer: 'ChatGPT', accountName: '', secret,
        algorithm: 'SHA1', digits: 6, period: TOTP_PERIOD_SECONDS,
        createdAt: '1970-01-01T00:00:00.000Z', updatedAt: '1970-01-01T00:00:00.000Z',
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
  if (!totp) return null;
  return <Pressable accessibilityRole="button" accessibilityLabel="复制当前验证码"
    onPress={() => void copyValue('验证码', totp.code)} style={styles.totpPreview}>
    <View>
      <Text style={styles.totpCaption}>当前验证码 · 点击复制</Text>
      <Text style={styles.totpCode}>{totp.code.slice(0, 3)} {totp.code.slice(3)}</Text>
    </View>
    <View style={styles.countdownBadge}><Text style={styles.countdownText}>{totp.remaining}</Text></View>
  </Pressable>;
}

export function AccountPrivateDetailsSheet({ account, session, syncing, onClose, onUpdated }: {
  account: AccountSummary | null;
  session: AuthSession;
  syncing: boolean;
  onClose: () => void;
  onUpdated: (account: AccountSummary) => void;
}) {
  const [note, setNote] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [password, setPassword] = useState('');
  const [totpSecret, setTotpSecret] = useState('');
  const [previewSecret, setPreviewSecret] = useState('');
  const [passwordHidden, setPasswordHidden] = useState(true);
  const [totpHidden, setTotpHidden] = useState(true);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [totpError, setTotpError] = useState('');
  const [saving, setSaving] = useState(false);
  const metadataEditable = account?.metadataEditable !== false;

  const privateDetails = account?.privateDetails;

  useEffect(() => {
    setNote(account?.note ?? '');
    setExpiresAt(account?.expiresAt ?? '');
    setPhoneNumber(privateDetails?.phoneNumber ?? '');
    setPassword(privateDetails?.password ?? '');
    setTotpSecret(privateDetails?.totpSecret ?? '');
    setPreviewSecret(privateDetails?.totpSecret ?? '');
    setPasswordHidden(true);
    setTotpHidden(true);
    setTotpError('');
  }, [
    account?.expiresAt,
    account?.id,
    account?.note,
    privateDetails?.password,
    privateDetails?.phoneNumber,
    privateDetails?.totpSecret,
  ]);

  const previewTotp = () => {
    try {
      const secret = normalizeAccountTotp(totpSecret);
      setTotpSecret(secret);
      setPreviewSecret(secret);
      setTotpError('');
    } catch {
      setPreviewSecret('');
      setTotpError('2FA 密钥格式不正确');
    }
  };

  const save = async () => {
    if (!account || saving) return;
    if (!validExpirationDate(expiresAt)) {
      Toast.fail('截止日期请使用 YYYY-MM-DD 格式');
      return;
    }
    let normalizedTotpSecret = '';
    try { normalizedTotpSecret = normalizeAccountTotp(totpSecret); }
    catch { setTotpError('2FA 密钥格式不正确'); return; }
    setSaving(true);
    try {
      const updated = await updateAccountDetails(session, account.id, {
        note,
        expiresAt,
        privateDetails: { password, phoneNumber: phoneNumber.trim(), totpSecret: normalizedTotpSecret },
      });
      onUpdated(updated);
      Toast.success('账号资料已保存');
      onClose();
    } catch (error) {
      Toast.fail(messageOf(error));
    } finally {
      setSaving(false);
    }
  };

  return <>
    <BottomSheet visible={Boolean(account) && !scannerOpen} tall title="账号资料" subtitle={account?.email}
      onClose={onClose} dismissible={!saving} actions={[
        { label: '取消', onPress: onClose, disabled: saving },
        {
          label: '保存',
          tone: 'primary',
          onPress: () => void save(),
          disabled: syncing,
          loading: saving,
        },
      ]}>
      {syncing ? <View style={styles.syncingBox}>
        <ActivityIndicator color="#14806f" />
        <Text style={styles.syncingText}>正在同步最新账号资料…</Text>
      </View> : <ScrollView style={styles.scroll} contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled">
        <Text style={styles.label}>预设可用截止日期</Text>
        <TextInput value={expiresAt} onChangeText={setExpiresAt} editable={metadataEditable}
          placeholder="YYYY-MM-DD" placeholderTextColor="#98a69f" maxLength={10} style={styles.input} />
        {!metadataEditable ? <Text style={styles.readOnlyHint}>该字段由管理员维护</Text> : null}

        <Text style={styles.label}>手机号</Text>
        <View style={styles.inputRow}>
          <TextInput value={phoneNumber} onChangeText={setPhoneNumber} keyboardType="phone-pad"
            placeholder="未设置" placeholderTextColor="#98a69f" maxLength={64}
            style={[styles.input, styles.flexInput]} />
          <Pressable accessibilityRole="button" disabled={!phoneNumber}
            onPress={() => void copyValue('手机号', phoneNumber)}
            style={[styles.copyButton, !phoneNumber && styles.disabled]}>
            <Text style={styles.copyButtonLabel}>复制</Text>
          </Pressable>
        </View>

        <SecretInputRow label="密码" value={password} onChangeText={setPassword}
          hidden={passwordHidden} onToggle={() => setPasswordHidden((value) => !value)} maxLength={1024} />

        <Text style={styles.label}>账号绑定 2FA</Text>
        <View style={styles.inputRow}>
          <TextInput value={totpSecret} onChangeText={(value) => {
            setTotpSecret(value);
            setPreviewSecret('');
            setTotpError('');
          }} onBlur={previewTotp} secureTextEntry={totpHidden} autoCapitalize="characters"
            autoCorrect={false} placeholder="Base32 密钥" placeholderTextColor="#98a69f"
            maxLength={512} style={[styles.input, styles.flexInput]} />
          <Pressable onPress={() => setTotpHidden((value) => !value)} style={styles.textButton}>
            <Text style={styles.textButtonLabel}>{totpHidden ? '显示' : '隐藏'}</Text>
          </Pressable>
          <Pressable onPress={() => setScannerOpen(true)} style={styles.scanButton}>
            <Text style={styles.scanButtonText}>扫码</Text>
          </Pressable>
        </View>
        {totpError ? <Text style={styles.errorText}>{totpError}</Text> : null}
        <AccountTotpPreview secret={previewSecret} />

        <Text style={styles.label}>备注</Text>
        <TextInput value={note} onChangeText={setNote} editable={metadataEditable} multiline
          textAlignVertical="top" placeholder="添加账号备注" placeholderTextColor="#98a69f"
          style={[styles.input, styles.noteInput]} />
        {!metadataEditable ? <Text style={styles.readOnlyHint}>该字段由管理员维护</Text> : null}
      </ScrollView>}
    </BottomSheet>
    <TotpQrScanner visible={Boolean(account) && scannerOpen} onClose={() => setScannerOpen(false)}
      onScan={(value) => {
        try {
          const secret = parseOtpAuthUri(value).secret;
          setTotpSecret(secret);
          setPreviewSecret(secret);
          setTotpError('');
        } catch {
          setTotpError('没有识别到有效的 Authenticator 二维码');
        } finally {
          setScannerOpen(false);
        }
      }} />
  </>;
}

const styles = StyleSheet.create({
  scroll: { maxHeight: 620 },
  content: { paddingBottom: 10 },
  syncingBox: { minHeight: 180, alignItems: 'center', justifyContent: 'center', gap: 10 },
  syncingText: { color: '#568072', fontSize: 12, fontWeight: '700' },
  label: { color: '#263b31', fontSize: 12, fontWeight: '800', marginTop: 14, marginBottom: 7 },
  inputRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  input: {
    minHeight: 46,
    borderWidth: 1,
    borderColor: '#cbdcd0',
    borderRadius: 10,
    backgroundColor: '#fbfdfb',
    color: '#13231c',
    fontSize: 14,
    paddingHorizontal: 12,
  },
  flexInput: { flex: 1 },
  noteInput: { minHeight: 110, paddingTop: 12 },
  textButton: { minHeight: 42, justifyContent: 'center', paddingHorizontal: 4 },
  textButtonLabel: { color: '#14806f', fontSize: 11, fontWeight: '800' },
  copyButton: { paddingHorizontal: 10, paddingVertical: 10, borderRadius: 8, backgroundColor: '#e6f8f1' },
  copyButtonLabel: { color: '#0b8065', fontSize: 11, fontWeight: '800' },
  scanButton: { paddingHorizontal: 10, paddingVertical: 10, borderRadius: 8, backgroundColor: '#e8f8fb' },
  scanButtonText: { color: '#168da2', fontSize: 11, fontWeight: '800' },
  readOnlyHint: { color: '#8a9891', fontSize: 10, marginTop: 5 },
  errorText: { color: '#bd3c35', fontSize: 11, marginTop: 6 },
  totpPreview: {
    minHeight: 82,
    marginTop: 10,
    paddingHorizontal: 15,
    borderWidth: 1,
    borderColor: '#bde8d8',
    borderRadius: 14,
    backgroundColor: '#eaf9f4',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  totpCaption: { color: '#568072', fontSize: 11, fontWeight: '700' },
  totpCode: { color: '#0b8065', fontSize: 26, fontWeight: '900', letterSpacing: 2, marginTop: 4 },
  countdownBadge: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 3,
    borderColor: '#18af8c',
    borderRadius: 22,
    backgroundColor: '#fff',
  },
  countdownText: { color: '#0b8065', fontSize: 13, fontWeight: '900' },
  disabled: { opacity: 0.42 },
});
