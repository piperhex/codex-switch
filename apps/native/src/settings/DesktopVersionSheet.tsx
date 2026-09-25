import { useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { BottomSheet } from '../components/BottomSheet';
import { fetchUserProfile } from '../api/client';
import type { AuthSession } from '../types';
import { useDesktopUpdate } from '../../../../shared/desktop-update/useDesktopUpdate';
import { styles } from './styles';

export function DesktopVersionSheet({ session, onClose }: { session: AuthSession; onClose: () => void }) {
  const options = useMemo(() => ({ authorize: async () => {
    await fetchUserProfile(session); return session;
  } }), [session]);
  const update = useDesktopUpdate(options);
  return <DesktopVersionContent update={update} onClose={onClose} />;
}

export function DesktopVersionContent({ update, onClose }: {
  update: ReturnType<typeof useDesktopUpdate>; onClose: () => void;
}) {
  const [confirmation, setConfirmation] = useState<{ deviceId: string; version: string } | null>(null);
  const status = update.status;
  const canConfirm = update.canInstall && confirmation?.deviceId === update.selectedId
    && confirmation.version === status?.latestVersion;
  const install = () => {
    if (!canConfirm || !confirmation) return;
    update.install(confirmation.version);
    setConfirmation(null);
  };
  return <BottomSheet visible title={confirmation ? '安装电脑端更新' : '电脑端版本'} onClose={onClose}
    dragFromHeaderOnly actions={confirmation ? [
      { label: '暂不安装', onPress: () => setConfirmation(null) },
      { label: '安装并重启', tone: 'primary', disabled: !canConfirm, onPress: install },
    ] : [
      { label: '检查更新', onPress: update.check, disabled: !update.canCheck },
      { label: '安装更新', tone: 'primary', disabled: !update.canInstall,
        onPress: () => {
          if (status?.latestVersion) setConfirmation({ deviceId: update.selectedId, version: status.latestVersion });
        } },
    ]}>
    <ScrollView><View style={styles.sheetBody}>
      {confirmation ? <>
        <Text style={styles.detailLabel}>{update.device?.name} · v{confirmation.version}</Text>
        <Text style={styles.hint}>安装后电脑端会重启，正在进行的连接和任务可能中断。请先保存工作。</Text>
      </> : <>
        <Text style={styles.detailLabel}>选择电脑</Text>
        {!update.connected && <Text style={styles.hint}>正在连接…</Text>}
        {update.connected && !update.devices.length && <Text style={styles.hint}>
          暂无电脑，请先在电脑端登录同一账号。</Text>}
        {update.devices.map((device) => <Pressable key={device.deviceId} accessibilityRole="radio"
          accessibilityState={{ checked: device.deviceId === update.selectedId }}
          onPress={() => update.select(device.deviceId)} style={styles.input}>
          <Text style={styles.detailLabel}>{device.deviceId === update.selectedId ? '● ' : '○ '}{device.name}</Text>
          <Text style={styles.hint}>{device.platform} · {device.online ? '在线' : '离线'}</Text>
        </Pressable>)}
        {update.device && <>
          <Text style={styles.detailLabel}>当前版本</Text>
          <Text selectable style={styles.detailValue}>
            {status?.currentVersion || update.device.appVersion || '暂未读取到版本'}</Text>
          {(!status || !update.connected || !update.device.online) && update.device.appVersion
            && <Text style={styles.hint}>上次连接时的版本</Text>}
          {status?.latestVersion && <Text style={styles.detailLabel}>可用版本 · v{status.latestVersion}</Text>}
          <Text accessibilityLiveRegion="polite" style={styles.hint}>{update.message}</Text>
          {status?.phase === 'downloading' && status.progress !== null
            && <Text style={styles.detailValue}>{status.progress}%</Text>}
          {status?.notes && <Text selectable style={styles.hint}>{status.notes}</Text>}
        </>}
      </>}
      {!!update.error && <Text accessibilityRole="alert" style={styles.error}>{update.error}</Text>}
    </View></ScrollView>
  </BottomSheet>;
}
