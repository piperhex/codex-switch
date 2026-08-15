import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Toast } from '../components/AppToast';
import { TotpCodeCard } from './TotpCodeCard';
import { TotpFormSheet } from './TotpFormSheet';
import { totpStyles } from './styles';
import { generateTotp } from './totp';
import type { TotpEntry, TotpManagerState } from './types';

function useTotpCodes(entries: TotpEntry[]) {
  const [now, setNow] = useState(Date.now());
  const codes = useMemo(() => Object.fromEntries(
    entries.map((entry) => [entry.id, generateTotp(entry, now)]),
  ), [entries, now]);

  useEffect(() => {
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, []);

  return { codes, now };
}

function PageHeader({ onManualAdd, onScanAdd }: {
  onManualAdd: () => void;
  onScanAdd: () => void;
}) {
  return <View style={styles.header}>
    <View style={styles.heading}>
      <Text style={styles.title}>2FA 验证码</Text>
      <Text style={styles.subtitle}>验证码自动刷新，点击即可复制</Text>
    </View>
    <View style={styles.actions}>
      <Pressable accessibilityRole="button" onPress={onManualAdd}
        style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]}>
        <Text style={styles.secondaryButtonText}>手动添加</Text>
      </Pressable>
      <Pressable accessibilityRole="button" onPress={onScanAdd}
        style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]}>
        <Text style={styles.primaryButtonText}>扫码添加</Text>
      </Pressable>
    </View>
  </View>;
}

function EntryList({ manager, codes, now, onEdit }: {
  manager: TotpManagerState;
  codes: Record<string, string>;
  now: number;
  onEdit: (entry: TotpEntry) => void;
}) {
  const confirmDelete = (entry: TotpEntry) => {
    Alert.alert('删除 2FA 密钥', `确定删除“${entry.issuer}”的密钥吗？`, [
      { text: '取消', style: 'cancel' },
      { text: '删除', style: 'destructive', onPress: () => manager.deleteEntry(entry.id) },
    ]);
  };

  if (!manager.initialized) return <ActivityIndicator color="#18af8c" />;
  if (!manager.entries.length) return <View style={totpStyles.empty}>
    <Text style={totpStyles.emptyIcon}>2FA</Text>
    <Text style={totpStyles.emptyTitle}>还没有 2FA 密钥</Text>
    <Text style={totpStyles.emptyText}>扫描二维码或手动输入密钥，即可生成动态验证码。</Text>
  </View>;
  return <>{manager.entries.map((entry) => <TotpCodeCard
    key={entry.id}
    entry={entry}
    code={codes[entry.id] ?? ''}
    now={now}
    onCopied={() => Toast.success('验证码已复制')}
    onDelete={() => confirmDelete(entry)}
    onEdit={() => onEdit(entry)}
  />)}</>;
}

export function TotpPage({ manager }: { manager: TotpManagerState }) {
  const [editing, setEditing] = useState<TotpEntry | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [scanOnOpen, setScanOnOpen] = useState(false);
  const { codes, now } = useTotpCodes(manager.entries);

  const openForm = (entry: TotpEntry | null, scanFirst = false) => {
    setEditing(entry);
    setScanOnOpen(scanFirst);
    setFormOpen(true);
  };

  return <View style={styles.page}>
    <PageHeader onManualAdd={() => openForm(null)} onScanAdd={() => openForm(null, true)} />
    <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
      <EntryList manager={manager} codes={codes} now={now} onEdit={openForm} />
    </ScrollView>
    <TotpFormSheet
      visible={formOpen}
      entry={editing}
      startWithScanner={scanOnOpen}
      onCancel={() => setFormOpen(false)}
      onSave={(draft) => {
        if (editing) manager.updateEntry(editing.id, draft);
        else manager.addEntry(draft);
      }}
    />
  </View>;
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#f7faf7' },
  header: { paddingHorizontal: 18, paddingTop: 18, paddingBottom: 14 },
  heading: { marginBottom: 16 },
  title: { color: '#13231c', fontSize: 27, lineHeight: 34, fontWeight: '900' },
  subtitle: { color: '#6f8177', fontSize: 12, marginTop: 4 },
  actions: { flexDirection: 'row', gap: 10 },
  secondaryButton: {
    flex: 1,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#bde8d8',
    borderRadius: 12,
    backgroundColor: '#ffffff',
  },
  secondaryButtonText: { color: '#0b8065', fontSize: 13, fontWeight: '800' },
  primaryButton: {
    flex: 1,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    backgroundColor: '#18af8c',
  },
  primaryButtonText: { color: '#ffffff', fontSize: 13, fontWeight: '800' },
  list: { flex: 1 },
  listContent: { paddingHorizontal: 18, paddingTop: 4, paddingBottom: 34 },
  pressed: { opacity: 0.76 },
});
