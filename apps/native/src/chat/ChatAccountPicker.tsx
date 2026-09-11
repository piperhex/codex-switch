import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { BottomSheet } from '../components/BottomSheet';
import type { AccountSummary, RemoteDevice } from '../types';
import { palette, styles } from './styles';

export interface ChatAccountSelection {
  accounts: AccountSummary[];
  busy: boolean;
  onSwitchAccount: (deviceId: string, accountId: string) => Promise<boolean>;
}

interface Props extends ChatAccountSelection { device?: RemoteDevice; active: boolean }

export function ChatAccountPicker({ accounts, busy, onSwitchAccount, device, active }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState('');
  const switching = useRef(false);
  const thirdParty = Boolean(device?.activeProviderId || device?.activeProviderGroup);
  const currentId = thirdParty ? null : device?.activeAccountId;
  const current = accounts.find((account) => account.id === currentId);
  const name = current?.email || (thirdParty ? '第三方账户' : '选择账户');
  const disabled = busy || Boolean(saving) || !device?.online || !device.localProxyRunning;
  const search = query.trim().toLowerCase();
  const choices = accounts.filter((account) => `${account.email} ${account.note}`.toLowerCase().includes(search));
  useEffect(() => { if (!active) setOpen(false); }, [active]);

  const select = async (accountId: string) => {
    if (!device || disabled || switching.current || accountId === currentId) return;
    switching.current = true;
    setSaving(accountId);
    setError('');
    try {
      if (await onSwitchAccount(device.deviceId, accountId)) setOpen(false);
      else setError('切换未完成，请重试。');
    } catch { setError('切换未完成，请重试。'); }
    finally { switching.current = false; setSaving(null); }
  };

  return <>
    <Pressable accessibilityRole="button" accessibilityLabel={`选择 Codex GUI 账户：${name}`}
      accessibilityState={{ expanded: open && active }} style={pickerStyles.trigger}
      onPress={() => { setQuery(''); setError(''); setOpen(true); }}>
      <Text numberOfLines={1} style={pickerStyles.caption}>Codex GUI</Text>
      <Text numberOfLines={1} style={pickerStyles.name}>{name} ▾</Text>
    </Pressable>
    <BottomSheet visible={open && active} title="选择 Codex GUI 账户"
      subtitle={device ? `${device.name} · 与电脑共用当前账户` : undefined}
      onClose={() => setOpen(false)} dismissible={!saving} dragFromHeaderOnly>
      <View style={pickerStyles.panel}>
        <TextInput accessibilityLabel="搜索账户" placeholder="搜索邮箱或备注" value={query} onChangeText={setQuery}
          autoCapitalize="none" autoCorrect={false} style={styles.search} />
        {!device?.online && <Text style={styles.subtitle}>电脑离线，连接后即可切换账户。</Text>}
        {device?.online && !device.localProxyRunning &&
          <Text style={styles.subtitle}>请先在电脑上开启本地代理，再切换账户。</Text>}
        {!!error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
        <ScrollView style={pickerStyles.list} keyboardShouldPersistTaps="handled">
          {choices.map((account) => {
            const selected = account.id === currentId;
            return <Pressable key={account.id} accessibilityRole="button" accessibilityLabel={account.email}
              accessibilityState={{ selected, disabled: disabled || selected }} disabled={disabled || selected}
              onPress={() => { void select(account.id); }}
              style={[pickerStyles.option, selected && pickerStyles.selected, disabled && styles.disabled]}>
              <View style={pickerStyles.copy}>
                <Text numberOfLines={1} style={styles.title}>{account.email}</Text>
                <Text numberOfLines={1} style={styles.subtitle}>{account.note || account.plan || 'ChatGPT'}</Text>
              </View>
              {saving === account.id ? <ActivityIndicator color={palette.green} accessibilityLabel="正在切换" />
                : selected && <Text style={styles.buttonText}>当前</Text>}
            </Pressable>;
          })}
          {!choices.length && <Text style={pickerStyles.empty}>
            {accounts.length ? '没有找到匹配的账户。' : '暂无可选账户，请先在电脑上添加并同步账户。'}</Text>}
        </ScrollView>
      </View>
    </BottomSheet>
  </>;
}

const pickerStyles = StyleSheet.create({
  trigger: { flex: 1, minWidth: 0, minHeight: 48, justifyContent: 'center', alignItems: 'flex-end' },
  caption: { color: palette.muted, fontSize: 11 },
  name: { color: palette.green, fontSize: 13, lineHeight: 20, maxWidth: '100%' },
  panel: { width: '100%', maxWidth: 400, alignSelf: 'center', gap: 12, paddingBottom: 16 },
  list: { maxHeight: 360 },
  option: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 64, padding: 12, borderRadius: 12 },
  selected: { backgroundColor: palette.pale },
  copy: { flex: 1, minWidth: 0 },
  empty: { color: palette.muted, fontSize: 13, lineHeight: 20, paddingVertical: 16 },
});
