import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { AccountSummary, RemoteDevice, RemoteProviderSummary } from '../types';
import { BottomSheet } from './BottomSheet';

interface ModelOptionProps {
  badge: string;
  title: string;
  subtitle: string;
  current: boolean;
  disabled: boolean;
  loading: boolean;
  onPress: () => void;
}

function ModelOption({
  badge,
  title,
  subtitle,
  current,
  disabled,
  loading,
  onPress,
}: ModelOptionProps) {
  return <Pressable
    accessibilityRole="button"
    accessibilityState={{ disabled, selected: current }}
    disabled={disabled}
    onPress={onPress}
    style={({ pressed }) => [
      styles.option,
      current && styles.optionCurrent,
      pressed && styles.optionPressed,
      disabled && !current && styles.optionDisabled,
    ]}
  >
    <View style={[styles.badge, current && styles.badgeCurrent]}>
      <Text style={[styles.badgeText, current && styles.badgeTextCurrent]}>{badge}</Text>
    </View>
    <View style={styles.optionCopy}>
      <Text style={styles.optionTitle} numberOfLines={1}>{title}</Text>
      <Text style={styles.optionSubtitle} numberOfLines={1}>{subtitle}</Text>
    </View>
    {loading
      ? <ActivityIndicator color="#14806f" size="small" />
      : current
        ? <View style={styles.currentPill}><Text style={styles.currentText}>当前</Text></View>
        : <Text style={styles.chevron}>›</Text>}
  </Pressable>;
}

interface RemoteModelSwitchSheetProps {
  device: RemoteDevice | null;
  accounts: AccountSummary[];
  providers: RemoteProviderSummary[];
  switchingAccountId: string | null;
  switchingProviderId: string | null;
  onClose: () => void;
  onSwitchAccount: (deviceId: string, accountId: string) => Promise<boolean>;
  onSwitchProvider: (deviceId: string, providerId: string) => Promise<boolean>;
}

export function RemoteModelSwitchSheet({
  device,
  accounts,
  providers,
  switchingAccountId,
  switchingProviderId,
  onClose,
  onSwitchAccount,
  onSwitchProvider,
}: RemoteModelSwitchSheetProps) {
  const busy = Boolean(switchingAccountId || switchingProviderId);
  const providerSupported = device?.capabilities?.includes('provider-switch') ?? false;
  const providerAvailable = providerSupported && Boolean(device?.localProxyRunning);

  const selectAccount = async (accountId: string) => {
    if (!device || busy) return;
    if (await onSwitchAccount(device.deviceId, accountId)) onClose();
  };
  const selectProvider = async (providerId: string) => {
    if (!device || busy || !providerAvailable) return;
    if (await onSwitchProvider(device.deviceId, providerId)) onClose();
  };

  return <BottomSheet
    visible={Boolean(device)}
    title="切换模型"
    subtitle={device ? `${device.name} · 选择这台 PC 使用的模型来源` : undefined}
    onClose={onClose}
    dismissible={!busy}
    tall
  >
    <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false}>
      <Text style={styles.sectionTitle}>官方模型</Text>
      {!accounts.length ? <Text style={styles.emptyText}>暂无已同步的官方账号。</Text> : accounts.map((account) => {
        const current = !device?.activeProviderId && device?.activeAccountId === account.id;
        return <ModelOption
          key={`account:${account.id}`}
          badge="O"
          title={account.email}
          subtitle={`官方模型 · ${account.plan || 'ChatGPT'}`}
          current={current}
          disabled={busy || !device?.online || current}
          loading={switchingAccountId === account.id}
          onPress={() => void selectAccount(account.id)}
        />;
      })}

      <View style={styles.providerHeading}>
        <Text style={styles.sectionTitle}>第三方 Provider</Text>
        {!providerSupported
          ? <Text style={styles.hint}>请先更新 PC 端</Text>
          : !device?.localProxyRunning
            ? <Text style={styles.hint}>请先在 PC 端启动本地代理</Text>
            : null}
      </View>
      {!providers.length ? <Text style={styles.emptyText}>暂无已同步的第三方 Provider。</Text> : providers.map((provider) => {
        const current = device?.activeProviderId === provider.id;
        return <ModelOption
          key={`provider:${provider.id}`}
          badge="P"
          title={provider.name}
          subtitle={provider.model || '由 Codex 选择模型'}
          current={current}
          disabled={busy || !device?.online || !providerAvailable || current}
          loading={switchingProviderId === provider.id}
          onPress={() => void selectProvider(provider.id)}
        />;
      })}
      <Text style={styles.footerHint}>
        在官方模型与第三方 Provider 之间切换后，需要重启 ChatGPT/Codex 才能加载当前模型。
      </Text>
    </ScrollView>
  </BottomSheet>;
}

const styles = StyleSheet.create({
  scroll: { maxHeight: 610 },
  sectionTitle: { color: '#52675c', fontSize: 12, fontWeight: '800', marginBottom: 9 },
  providerHeading: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 20,
  },
  hint: { color: '#b06b28', fontSize: 10, marginBottom: 9, maxWidth: 190, textAlign: 'right' },
  emptyText: { color: '#7c8c83', fontSize: 12, lineHeight: 18, paddingVertical: 12 },
  option: {
    alignItems: 'center',
    backgroundColor: '#fff',
    borderColor: '#dce9e2',
    borderRadius: 13,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 11,
    marginBottom: 9,
    minHeight: 66,
    padding: 12,
  },
  optionCurrent: { backgroundColor: '#f0faf6', borderColor: '#9bd5c2' },
  optionPressed: { opacity: 0.82 },
  optionDisabled: { opacity: 0.52 },
  badge: {
    alignItems: 'center',
    backgroundColor: '#e7f5ef',
    borderRadius: 11,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  badgeCurrent: { backgroundColor: '#ccecdf' },
  badgeText: { color: '#14806f', fontSize: 14, fontWeight: '900' },
  badgeTextCurrent: { color: '#0b6e59' },
  optionCopy: { flex: 1, minWidth: 0 },
  optionTitle: { color: '#17352a', fontSize: 13, fontWeight: '800' },
  optionSubtitle: { color: '#7c8c83', fontSize: 10, marginTop: 5 },
  currentPill: { backgroundColor: '#dff4eb', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 5 },
  currentText: { color: '#0c765f', fontSize: 10, fontWeight: '800' },
  chevron: { color: '#91a198', fontSize: 24, lineHeight: 25 },
  footerHint: { color: '#7c8c83', fontSize: 11, lineHeight: 17, marginTop: 13, textAlign: 'center' },
});
