import { useState } from 'react';
import { ActivityIndicator, StyleSheet, Switch, Text, View } from 'react-native';
import { Toast } from '../components/AppToast';
import type { TotpManagerState } from './types';

export function TotpSyncSettings({ manager }: { manager: TotpManagerState }) {
  const [changing, setChanging] = useState(false);
  const change = async (enabled: boolean) => {
    setChanging(true);
    try {
      await manager.setCloudSyncEnabled(enabled);
      Toast.success(enabled ? '已开启 2FA 云同步' : '已关闭 2FA 云同步');
    } catch {
      Toast.fail(enabled ? '已开启同步，但首次上传失败，请稍后重试' : '关闭 2FA 云同步失败');
    } finally {
      setChanging(false);
    }
  };
  const disabled = changing || manager.syncing || !manager.initialized;
  return <>
    <Text style={styles.sectionLabel}>2FA 密钥</Text>
    <View style={styles.card}>
      <View style={styles.row}>
        <View style={styles.copy}>
          <Text style={styles.title}>自动云同步</Text>
          <Text style={styles.description}>开启后自动同步变更；关闭时仍可在 2FA 页面下拉获取云端密钥。</Text>
        </View>
        {disabled ? <ActivityIndicator color="#18af8c" size="small" /> : <Switch
          accessibilityLabel="同步 2FA 密钥至云端" value={manager.cloudSyncEnabled}
          onValueChange={(enabled) => void change(enabled)}
          trackColor={{ false: '#c8d6cd', true: '#87d9cb' }}
          thumbColor={manager.cloudSyncEnabled ? '#18af8c' : '#fff'} />}
      </View>
      <Text style={styles.warning}>
        默认关闭。开启后，手机上的敏感密钥会上传并保存到你的云端服务器。
      </Text>
    </View>
  </>;
}

const styles = StyleSheet.create({
  sectionLabel: {
    color: '#6f8177',
    fontSize: 13,
    fontWeight: '700',
    marginLeft: 3,
    marginBottom: 9,
    marginTop: 2,
  },
  card: {
    backgroundColor: '#fff',
    borderColor: '#dce8df',
    borderWidth: 1,
    borderRadius: 16,
    padding: 17,
    marginBottom: 22,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  copy: { flex: 1, minWidth: 0 },
  title: { color: '#13231c', fontSize: 16, fontWeight: '800' },
  description: { color: '#6f8177', fontSize: 12, lineHeight: 18, marginTop: 6 },
  warning: { color: '#9a6c17', fontSize: 11, lineHeight: 17, marginTop: 13 },
});
