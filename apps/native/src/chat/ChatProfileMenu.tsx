import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import Feather from '@expo/vector-icons/Feather';
import { BottomSheet } from '../components/BottomSheet';
import type { GuiAccountChoice, GuiAccountsClient } from '../../../../shared/remote-chat/guiAccounts';
import { useGuiAccounts } from '../../../../shared/remote-chat/client/useGuiAccounts';
import { palette, styles } from './styles';

interface Props {
  client: GuiAccountsClient; deviceName?: string; ready: boolean; active: boolean;
  email: string; chooseDevice: () => void;
}

export function ChatProfileMenu({ client, deviceName, ready, active, email, chooseDevice }: Props) {
  const [panel, setPanel] = useState<'profile' | 'accounts' | null>(null);
  const [query, setQuery] = useState('');
  const accounts = useGuiAccounts(client, active && ready);
  const selection = accounts.snapshot?.selection;
  const current = accounts.snapshot?.choices.find((choice) =>
    selection?.kind === choice.kind && selection.id === choice.id);
  const name = current?.name || '选择账户';
  const initials = Array.from(current?.name.trim() || '').slice(0, 2).join('') || '我';
  const disabled = accounts.loading || Boolean(accounts.saving) || !ready || !accounts.snapshot?.running;
  const search = query.trim().toLowerCase();
  const choices = accounts.snapshot?.choices.filter((choice) =>
    `${choice.name} ${choice.detail}`.toLowerCase().includes(search)) ?? [];
  useEffect(() => { if (!active) setPanel(null); }, [active]);

  const select = async (choice: GuiAccountChoice) => {
    if (disabled || !choice.available || choice === current) return;
    if (await accounts.select({ kind: choice.kind, id: choice.id })) setPanel('profile');
  };

  return <>
    <Pressable accessibilityRole="button" accessibilityLabel="打开头像菜单"
      accessibilityState={{ expanded: panel !== null && active }} style={pickerStyles.trigger}
      onPress={() => setPanel('profile')}>
      <Text style={pickerStyles.initials}>{initials}</Text>
    </Pressable>
    <BottomSheet visible={panel !== null && active} title={panel === 'accounts' ? '切换账户' : '账户与电脑'}
      subtitle={panel === 'accounts' ? '与电脑共用当前聊天账户' : undefined}
      onClose={() => setPanel(null)} dismissible={!accounts.saving} dragFromHeaderOnly
      onBack={panel === 'accounts' && !accounts.saving ? () => setPanel('profile') : undefined}>
      {panel === 'profile' ? <View style={pickerStyles.panel}>
        <Text style={pickerStyles.email}>{email}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="切换电脑" style={pickerStyles.option}
          onPress={() => { setPanel(null); chooseDevice(); }}>
          <Feather name="monitor" size={22} color={palette.ink} />
          <View style={pickerStyles.copy}><Text style={styles.title}>切换电脑</Text>
            <Text numberOfLines={1} style={styles.subtitle}>{deviceName || '选择电脑'}</Text></View>
          <Feather name="chevron-right" size={18} color={palette.muted} />
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="切换账户" style={pickerStyles.option}
          onPress={() => { setQuery(''); setPanel('accounts'); if (ready) accounts.refresh(); }}>
          <Feather name="user" size={22} color={palette.ink} />
          <View style={pickerStyles.copy}><Text style={styles.title}>切换账户</Text>
            <Text numberOfLines={1} style={styles.subtitle}>{name}</Text></View>
          <Feather name="chevron-right" size={18} color={palette.muted} />
        </Pressable>
      </View> : <View style={pickerStyles.panel}>
        <TextInput accessibilityLabel="搜索账户" placeholder="搜索名称或备注" value={query} onChangeText={setQuery}
          autoCapitalize="none" autoCorrect={false} style={styles.search} />
        {!ready && <Text style={styles.subtitle}>连接电脑后即可切换账户。</Text>}
        {accounts.loading && <ActivityIndicator color={palette.green} accessibilityLabel="正在同步账户" />}
        {ready && accounts.snapshot && !accounts.snapshot.running &&
          <Text style={styles.subtitle}>请先在电脑上开启本地代理，再切换账户。</Text>}
        {!!accounts.error && <View style={styles.row}>
          <Text accessibilityRole="alert" style={[styles.error, styles.fill]}>{accounts.error}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="重试读取账户"
            disabled={!ready || accounts.loading || Boolean(accounts.saving)} onPress={accounts.refresh}>
            <Text style={styles.buttonText}>重试</Text>
          </Pressable>
        </View>}
        <ScrollView style={pickerStyles.list} keyboardShouldPersistTaps="handled">
          {choices.map((choice) => {
            const selected = choice === current;
            return <Pressable key={`${choice.kind}:${choice.id}`} accessibilityRole="button"
              accessibilityLabel={choice.name} accessibilityState={{
                selected, disabled: disabled || selected || !choice.available,
              }} disabled={disabled || selected || !choice.available} onPress={() => { void select(choice); }}
              style={[pickerStyles.option, selected && pickerStyles.selected,
                (disabled || !choice.available) && styles.disabled]}>
              <View style={pickerStyles.copy}>
                <Text numberOfLines={1} style={styles.title}>{choice.name}</Text>
                <Text numberOfLines={1} style={styles.subtitle}>
                  {choice.available ? choice.detail : '此账户暂不可用'}</Text>
              </View>
              {accounts.saving === `${choice.kind}:${choice.id}`
                ? <ActivityIndicator color={palette.green} accessibilityLabel="正在切换" />
                : selected && <Text style={styles.buttonText}>当前</Text>}
            </Pressable>;
          })}
          {!choices.length && accounts.snapshot && !accounts.loading && <Text style={pickerStyles.empty}>
            {accounts.snapshot.choices.length ? '没有找到匹配的账户。' : '暂无可选账户，请先在电脑上添加账户。'}</Text>}
        </ScrollView>
      </View>}
    </BottomSheet>
  </>;
}

const pickerStyles = StyleSheet.create({
  trigger: { width: 52, height: 52, borderRadius: 26, backgroundColor: '#304e63',
    justifyContent: 'center', alignItems: 'center', borderWidth: 5, borderColor: palette.background },
  initials: { color: '#fff', fontSize: 15, fontWeight: '500' },
  email: { color: palette.muted, fontSize: 14, lineHeight: 21 },
  panel: { width: '100%', maxWidth: 400, alignSelf: 'center', gap: 12, paddingBottom: 16 },
  list: { maxHeight: 360 },
  option: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 64, padding: 12, borderRadius: 12 },
  selected: { backgroundColor: palette.pale },
  copy: { flex: 1, minWidth: 0 },
  empty: { color: palette.muted, fontSize: 13, lineHeight: 20, paddingVertical: 16 },
});
