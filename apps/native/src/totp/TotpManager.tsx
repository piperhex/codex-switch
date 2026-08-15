import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, Text, View } from 'react-native';
import { BottomSheet } from '../components/BottomSheet';
import { Toast } from '../components/AppToast';
import { generateTotp } from './totp';
import { TotpCodeCard } from './TotpCodeCard';
import { TotpFormSheet } from './TotpFormSheet';
import { totpStyles as styles } from './styles';
import type { TotpEntry, TotpManagerState } from './types';

export function TotpManager({ manager }: { manager: TotpManagerState }) {
  const [open, setOpen] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<TotpEntry | null>(null);
  const [now, setNow] = useState(Date.now());
  const codes = useMemo(() => Object.fromEntries(
    manager.entries.map((entry) => [entry.id, generateTotp(entry, now)]),
  ), [manager.entries, now]);

  useEffect(() => {
    if (!open) return undefined;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [open]);

  const openForm = (entry: TotpEntry | null) => {
    setEditing(entry);
    setFormOpen(true);
  };

  const confirmDelete = (entry: TotpEntry) => {
    Alert.alert('删除 2FA 密钥', `确定删除“${entry.issuer}”的密钥吗？`, [
      { text: '取消', style: 'cancel' },
      { text: '删除', style: 'destructive', onPress: () => manager.deleteEntry(entry.id) },
    ]);
  };

  return <>
    <Pressable accessibilityRole="button" accessibilityLabel="打开 2FA 验证码"
      style={({ pressed }) => [styles.trigger, pressed && { opacity: 0.78 }]} onPress={() => setOpen(true)}>
      <Text style={styles.triggerText}>2FA</Text>
    </Pressable>
    <BottomSheet visible={open && !formOpen} tall title="2FA 验证码"
      subtitle={manager.cloudSyncEnabled ? '云同步已开启，可在设置中关闭' : '仅保存在这台手机上'}
      onClose={() => setOpen(false)} actions={[
        { label: '添加密钥', tone: 'primary', onPress: () => openForm(null) },
      ]}>
      <ScrollView style={styles.managerBody} contentContainerStyle={styles.managerBodyContent}>
        <Text style={styles.intro}>验证码会自动刷新，点击验证码即可复制。</Text>
        {!manager.initialized ? <ActivityIndicator color="#18af8c" />
          : manager.entries.length ? manager.entries.map((entry) => <TotpCodeCard
            key={entry.id} entry={entry} code={codes[entry.id] ?? ''} now={now}
            onCopied={() => Toast.success('验证码已复制')}
            onDelete={() => confirmDelete(entry)} onEdit={() => openForm(entry)} />)
            : <View style={styles.empty}>
              <Text style={styles.emptyIcon}>2FA</Text>
              <Text style={styles.emptyTitle}>还没有 2FA 密钥</Text>
              <Text style={styles.emptyText}>扫描二维码或手动输入密钥，即可在手机上生成动态验证码。</Text>
            </View>}
      </ScrollView>
    </BottomSheet>
    <TotpFormSheet visible={formOpen} entry={editing} onCancel={() => setFormOpen(false)}
      onSave={(draft) => {
        if (editing) manager.updateEntry(editing.id, draft);
        else manager.addEntry(draft);
      }} />
  </>;
}
