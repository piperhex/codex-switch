import { getLocale, t, useLanguage } from '../i18n';
import { Dropdown } from 'antd';
import { Clock, ExternalLink, KeyRound, Laptop, MoreVertical, Server, Trash2, UserRound } from 'lucide-react';
import type { AccountSummary, RemoteDevice, RemoteProviderSummary } from '../types';
import { remoteModelOptions, type RemoteModelTarget } from '../../../../shared/remote-chat/modelTarget';

interface DeviceCardProps {
  device: RemoteDevice;
  accounts: AccountSummary[];
  providers: RemoteProviderSummary[];
  deletingDeviceId: string | null;
  switchingModelDeviceId: string | null;
  switchingAuthDeviceId: string | null;
  onSwitchModel: (deviceId: string) => void;
  onSelectAuthAccount: (deviceId: string) => void;
  onDelete: (device: RemoteDevice) => void;
}

function platformLabel(platform: string) {
  switch (platform.trim().toLowerCase()) {
    case 'windows': return 'Windows';
    case 'darwin':
    case 'macos': return 'macOS';
    case 'linux': return 'Linux';
    default: return platform || t("未知平台");
  }
}

function modelLabel(device: RemoteDevice, accounts: AccountSummary[], providers: RemoteProviderSummary[],
  target: RemoteModelTarget) {
  const selection = remoteModelOptions(device, target);
  const account = accounts.find(item => item.id === selection.accountId);
  const provider = providers.find(item => item.id === selection.providerId);
  if (selection.group) return t("分组 · {value1}", { value1: selection.group });
  if (!selection.providerId) return account ? t("官方 · {value1}", { value1: account.email }) : t("未选择");
  if (!provider) return t("模型信息暂不可用");
  return `${provider.name}${provider.model ? ` · ${provider.model}` : ''}`;
}

function lastSeenLabel(device: RemoteDevice) {
  if (device.online) return t("当前在线");
  const date = new Date(device.lastSeenAt);
  if (Number.isNaN(date.getTime())) return t("时间未知");
  return new Intl.DateTimeFormat(getLocale(), {
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(date);
}

function PlatformIcon({ platform }: { platform: string }) {
  useLanguage();
  if (platform.trim().toLowerCase() !== 'windows') return <Laptop size={24} aria-hidden />;
  return <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
    <path d="M2 4.5 10.5 3.3V11H2zm10-1.4L22 1.7V11H12zM2 12.5h8.5v7.7L2 19zm10 0h10v9.3l-10-1.4z" />
  </svg>;
}

function DeviceDetails({ device, accounts, providers }: Pick<DeviceCardProps, 'device' | 'accounts' | 'providers'>) {
  useLanguage();
  const account = accounts.find((item) => item.id === device.activeAccountId);
  const authAccount = accounts.find((item) => item.id === device.openaiAuthAccountId);
  const details = [
    { icon: UserRound, label: t("代理接口"), value: modelLabel(device, accounts, providers, 'proxy') },
    ...(device.capabilities.includes('gui-model-switch')
      ? [{ icon: Laptop, label: 'Codex GUI', value: modelLabel(device, accounts, providers, 'gui') }] : []),
    { icon: Server, label: t("设备账号"),
      value: account?.email ?? (device.activeAccountId ? t("账号信息暂不可用") : t("未选择")) },
    { icon: KeyRound, label: t("代理登录态"),
      value: authAccount?.email ?? (device.openaiAuthAccountId ? t("账号信息暂不可用") : t("未设置")) },
    { icon: Clock, label: t("最后在线"), value: lastSeenLabel(device) },
  ];
  return <span className="device-details">{details.map(({ icon: Icon, label, value }) =>
    <span className="device-detail" key={label}>
      <Icon size={18} aria-hidden /><span>{label}</span><span className="device-detail-value">{value}</span>
    </span>)}</span>;
}

export function DeviceCard(props: DeviceCardProps) {
  useLanguage();
  const { device, deletingDeviceId, switchingModelDeviceId, switchingAuthDeviceId } = props;
  const busy = switchingModelDeviceId === device.deviceId || deletingDeviceId === device.deviceId;
  const items = [
    { key: 'auth', icon: <ExternalLink size={18} />, label: t("代理登录态账号"),
      disabled: !device.online || Boolean(switchingAuthDeviceId),
      onClick: () => props.onSelectAuthAccount(device.deviceId) },
    { key: 'delete', icon: <Trash2 size={18} />, label: device.online ? t("在线不可删除") : t("删除设备"),
      danger: true, disabled: device.online || Boolean(deletingDeviceId), onClick: () => props.onDelete(device) },
  ];
  return <article className={`device-card ${device.online ? 'online' : 'offline'}`}>
    <button type="button" className="device-card-main" disabled={!device.online || busy} aria-busy={busy}
      aria-label={`${device.name}，${device.online ? t("点击切换模型") : t("离线")}`}
      onClick={() => props.onSwitchModel(device.deviceId)}>
      <span className="device-card-header">
        <span className="device-platform"><PlatformIcon platform={device.platform} /></span>
        <span className="device-identity"><strong>{device.name}</strong>
          <span>{platformLabel(device.platform)}{device.appVersion ? ` · v${device.appVersion}` : ''}</span></span>
        <span className="device-status"><i />{busy ? t("处理中") : device.online ? t("在线") : t("离线")}</span>
      </span>
      <DeviceDetails device={device} accounts={props.accounts} providers={props.providers} />
    </button>
    <Dropdown trigger={['click']} placement="bottomRight" menu={{ items }} overlayClassName="device-options-menu">
      <button type="button" className="device-menu-trigger" aria-label={t("{value1} 的更多操作", { value1: device.name })}>
        <MoreVertical size={20} aria-hidden />
      </button>
    </Dropdown>
  </article>;
}
