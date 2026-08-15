import { useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { BottomSheet } from '../components/BottomSheet';
import { normalizeTotpSecret, parseOtpAuthUri } from './totp';
import { TotpQrScanner } from './TotpQrScanner';
import { totpStyles as styles } from './styles';
import type { TotpAlgorithm, TotpDraft, TotpEntry } from './types';

interface TotpFormSheetProps {
  entry: TotpEntry | null;
  onCancel: () => void;
  onSave: (draft: TotpDraft) => void;
  visible: boolean;
}

const DEFAULT_DRAFT: TotpDraft = {
  issuer: '',
  accountName: '',
  secret: '',
  algorithm: 'SHA1',
  digits: 6,
  period: 30,
};

function OptionRow<T extends string | number>({ options, selected, onChange }: {
  onChange: (value: T) => void;
  options: readonly T[];
  selected: T;
}) {
  return <View style={styles.optionRow}>{options.map((value) => {
    const active = selected === value;
    return <Pressable key={value} onPress={() => onChange(value)}
      style={[styles.option, active && styles.optionActive]}>
      <Text style={[styles.optionText, active && styles.optionTextActive]}>{value}</Text>
    </Pressable>;
  })}</View>;
}

export function TotpFormSheet({ entry, onCancel, onSave, visible }: TotpFormSheetProps) {
  const [draft, setDraft] = useState<TotpDraft>(DEFAULT_DRAFT);
  const [periodInput, setPeriodInput] = useState('30');
  const [error, setError] = useState('');
  const [showSecret, setShowSecret] = useState(false);
  const [scannerOpen, setScannerOpen] = useState(false);

  useEffect(() => {
    if (!visible) return;
    const initial = entry ? {
      issuer: entry.issuer,
      accountName: entry.accountName,
      secret: entry.secret,
      algorithm: entry.algorithm,
      digits: entry.digits,
      period: entry.period,
    } : DEFAULT_DRAFT;
    setDraft(initial);
    setPeriodInput(String(initial.period));
    setError('');
    setShowSecret(false);
  }, [entry, visible]);

  const patchDraft = <K extends keyof TotpDraft>(key: K, value: TotpDraft[K]) => {
    setDraft((current) => ({ ...current, [key]: value }));
  };

  const applyQrValue = (value: string) => {
    setScannerOpen(false);
    try {
      const parsed = parseOtpAuthUri(value);
      setDraft(parsed);
      setPeriodInput(String(parsed.period));
      setError('');
    } catch {
      setError('没有识别到有效的 Authenticator 二维码，请重试或手动输入。');
    }
  };

  const save = () => {
    try {
      const secret = draft.secret.trim().toLowerCase().startsWith('otpauth://')
        ? parseOtpAuthUri(draft.secret)
        : { ...draft, secret: normalizeTotpSecret(draft.secret), period: Number(periodInput) };
      if (!secret.issuer.trim() || !secret.accountName.trim()) throw new Error('missing-fields');
      if (!Number.isInteger(secret.period) || secret.period < 15 || secret.period > 120) {
        throw new Error('invalid-period');
      }
      onSave(secret);
      onCancel();
    } catch {
      setError('请检查服务名称、账号、密钥和刷新周期是否填写正确。');
    }
  };

  return <>
    <BottomSheet visible={visible && !scannerOpen} tall title={entry ? '编辑 2FA 密钥' : '添加 2FA 密钥'}
      subtitle="支持标准 Authenticator 密钥和二维码" onClose={onCancel}
      actions={[{ label: '取消', onPress: onCancel }, { label: '保存', tone: 'primary', onPress: save }]}>
      <ScrollView style={styles.formScroll} contentContainerStyle={styles.formContent}
        keyboardShouldPersistTaps="handled">
        {!entry ? <Pressable style={styles.qrButton} onPress={() => setScannerOpen(true)}>
          <Text style={styles.qrButtonText}>▣ 扫描二维码自动填写</Text>
        </Pressable> : null}
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <Text style={styles.fieldLabel}>服务名称</Text>
        <TextInput value={draft.issuer} onChangeText={(value) => patchDraft('issuer', value)}
          placeholder="例如 GitHub" placeholderTextColor="#98a9a0" style={styles.input} maxLength={160} />
        <Text style={styles.fieldLabel}>账号</Text>
        <TextInput value={draft.accountName} onChangeText={(value) => patchDraft('accountName', value)}
          placeholder="邮箱或用户名" placeholderTextColor="#98a9a0" style={styles.input} maxLength={320} />
        <Text style={styles.fieldLabel}>密钥</Text>
        <View style={styles.secretRow}>
          <TextInput value={draft.secret} onChangeText={(value) => patchDraft('secret', value)}
            placeholder="Base32 密钥或 otpauth:// 地址" placeholderTextColor="#98a9a0"
            autoCapitalize="characters" autoCorrect={false} secureTextEntry={!showSecret}
            style={[styles.input, styles.secretInput]} />
          <Pressable style={styles.revealButton} onPress={() => setShowSecret((current) => !current)}>
            <Text style={styles.revealText}>{showSecret ? '隐藏' : '显示'}</Text>
          </Pressable>
        </View>
        <Text style={styles.hint}>密钥会保存在手机系统安全存储中，默认不会上传云端。</Text>
        <Text style={styles.fieldLabel}>算法</Text>
        <OptionRow<TotpAlgorithm> options={['SHA1', 'SHA256', 'SHA512']} selected={draft.algorithm}
          onChange={(value) => patchDraft('algorithm', value)} />
        <Text style={styles.fieldLabel}>验证码位数</Text>
        <OptionRow<6 | 8> options={[6, 8]} selected={draft.digits}
          onChange={(value) => patchDraft('digits', value)} />
        <Text style={styles.fieldLabel}>刷新周期（秒）</Text>
        <TextInput value={periodInput} onChangeText={(value) => setPeriodInput(value.replace(/\D/g, '').slice(0, 3))}
          keyboardType="number-pad" placeholder="30" placeholderTextColor="#98a9a0" style={styles.input} />
        <Text style={styles.hint}>支持 15 至 120 秒，通常为 30 秒。</Text>
      </ScrollView>
    </BottomSheet>
    <TotpQrScanner visible={visible && scannerOpen} onClose={() => setScannerOpen(false)} onScan={applyQrValue} />
  </>;
}
