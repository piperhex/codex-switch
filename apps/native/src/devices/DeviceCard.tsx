import { Ionicons } from '@expo/vector-icons';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import type { AccountSummary, RemoteDevice, RemoteProviderSummary } from '../types';
import { remoteModelOptions, type RemoteModelTarget } from '../../../../shared/remote-chat/modelTarget';
import { deviceColors, styles } from './styles';

type IconName = keyof typeof Ionicons.glyphMap;

function platformInfo(platform: string): { label: string; icon: IconName } {
  switch (platform.trim().toLowerCase()) {
    case 'windows': return { label: 'Windows', icon: 'logo-windows' };
    case 'darwin':
    case 'macos': return { label: 'macOS', icon: 'logo-apple' };
    case 'linux': return { label: 'Linux', icon: 'logo-tux' };
    default: return { label: platform || '未知平台', icon: 'desktop-outline' };
  }
}

function modelLabel(device: RemoteDevice, accounts: AccountSummary[], providers: RemoteProviderSummary[],
  target: RemoteModelTarget) {
  const selection = remoteModelOptions(device, target);
  const account = accounts.find(item => item.id === selection.accountId);
  const provider = providers.find(item => item.id === selection.providerId);
  if (selection.group) return `分组 · ${selection.group}`;
  if (!selection.providerId) return account ? `官方 · ${account.email}` : '未选择';
  if (!provider) return '模型信息暂不可用';
  return `${provider.name}${provider.model ? ` · ${provider.model}` : ''}`;
}

function lastSeenLabel(device: RemoteDevice) {
  if (device.online) return '当前在线';
  const date = new Date(device.lastSeenAt);
  if (Number.isNaN(date.getTime())) return '时间未知';
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(date);
}

function DeviceDetail({ icon, label, value }: { icon: IconName; label: string; value: string }) {
  return <View style={styles.detail}>
    <Ionicons name={icon} size={17} color={deviceColors.muted} />
    <Text style={styles.detailLabel}>{label}</Text>
    <Text style={styles.detailValue}>{value}</Text>
  </View>;
}

function DeviceIdentity({ device, busy }: { device: RemoteDevice; busy: boolean }) {
  const platform = platformInfo(device.platform);
  return <View style={[styles.cardTop, styles.topInset]}>
    <View style={styles.platform}><Ionicons name={platform.icon} size={25} color={deviceColors.green} /></View>
    <View style={styles.identity}>
      <Text style={styles.name} numberOfLines={2}>{device.name}</Text>
      <Text style={styles.meta}>{platform.label}{device.appVersion ? ` · v${device.appVersion}` : ''}</Text>
    </View>
    <View style={[styles.badge, !device.online && styles.badgeOffline]}>
      {busy ? <ActivityIndicator size="small" color={deviceColors.green} />
        : <View style={[styles.dot, !device.online && styles.dotOffline]} />}
      <Text style={[styles.badgeText, !device.online && styles.muted]}>{device.online ? '在线' : '离线'}</Text>
    </View>
  </View>;
}

export function DeviceCard({ device, accounts, providers, busy, onSwitchModel, onOpenMenu }: {
  device: RemoteDevice;
  accounts: AccountSummary[];
  providers: RemoteProviderSummary[];
  busy: boolean;
  onSwitchModel: () => void;
  onOpenMenu: () => void;
}) {
  const account = accounts.find((item) => item.id === device.activeAccountId);
  const authAccount = accounts.find((item) => item.id === device.openaiAuthAccountId);
  const disabled = !device.online || busy;
  return <View>
    <Pressable accessibilityRole="button" accessibilityLabel={`${device.name}，${device.online ? '在线' : '离线'}`}
      accessibilityHint={device.online ? '打开切换模型抽屉' : '设备上线后可切换模型'}
      accessibilityState={{ disabled, busy }} disabled={disabled} onPress={onSwitchModel}
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}>
      <DeviceIdentity device={device} busy={busy} />
      <View style={styles.divider} />
      <DeviceDetail icon="person-outline" label="代理接口" value={modelLabel(device, accounts, providers, 'proxy')} />
      {device.capabilities.includes('gui-model-switch') && <DeviceDetail icon="desktop-outline" label="Codex GUI"
        value={modelLabel(device, accounts, providers, 'gui')} />}
      <DeviceDetail icon="server-outline" label="设备账号"
        value={account?.email ?? (device.activeAccountId ? '账号信息暂不可用' : '未选择')} />
      <DeviceDetail icon="key-outline" label="代理登录态"
        value={authAccount?.email ?? (device.openaiAuthAccountId ? '账号信息暂不可用' : '未设置')} />
      <DeviceDetail icon="time-outline" label="最后在线" value={lastSeenLabel(device)} />
    </Pressable>
    <Pressable accessibilityRole="button" accessibilityLabel={`${device.name} 的更多操作`}
      onPress={onOpenMenu} style={({ pressed }) => [styles.menuTrigger, pressed && styles.pressed]}>
      <Ionicons name="ellipsis-vertical" size={20} color={deviceColors.muted} />
    </Pressable>
  </View>;
}
