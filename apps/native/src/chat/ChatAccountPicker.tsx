import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { BottomSheet } from '../components/BottomSheet';
import type { GuiAccountChoice, GuiAccountsClient } from '../../../../shared/remote-chat/guiAccounts';
import { useGuiAccounts } from '../../../../shared/remote-chat/client/useGuiAccounts';
import { palette, styles } from './styles';

interface Props { client: GuiAccountsClient; deviceName?: string; ready: boolean; active: boolean }

export function ChatAccountPicker({ client, deviceName, ready, active }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const accounts = useGuiAccounts(client, active && ready);
  const selection = accounts.snapshot?.selection;
  const current = accounts.snapshot?.choices.find((choice) =>
    selection?.kind === choice.kind && selection.id === choice.id);
  const name = current?.name || '选择账户';
  const disabled = accounts.loading || Boolean(accounts.saving) || !ready || !accounts.snapshot?.running;
  const search = query.trim().toLowerCase();
  const choices = accounts.snapshot?.choices.filter((choice) =>
    `${choice.name} ${choice.detail}`.toLowerCase().includes(search)) ?? [];
  useEffect(() => { if (!active) setOpen(false); }, [active]);

  const select = async (choice: GuiAccountChoice) => {
    if (disabled || !choice.available || choice === current) return;
    if (await accounts.select({ kind: choice.kind, id: choice.id })) setOpen(false);
  };

  return <>
    <Pressable accessibilityRole="button" accessibilityLabel={`选择 Codex GUI 账户：${name}`}
      accessibilityState={{ expanded: open && active }} style={pickerStyles.trigger}
      onPress={() => { setQuery(''); setOpen(true); if (ready) accounts.refresh(); }}>
      <Text numberOfLines={1} style={pickerStyles.caption}>Codex GUI</Text>
      <Text numberOfLines={1} style={pickerStyles.name}>{name} ▾</Text>
    </Pressable>
    <BottomSheet visible={open && active} title="选择 Codex GUI 账户"
      subtitle={deviceName ? `${deviceName} · 与电脑共用当前账户` : undefined}
      onClose={() => setOpen(false)} dismissible={!accounts.saving} dragFromHeaderOnly>
      <View style={pickerStyles.panel}>
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
