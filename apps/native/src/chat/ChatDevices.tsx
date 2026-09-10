import { Pressable, ScrollView, Text, View } from 'react-native';
import { BottomSheet } from '../components/BottomSheet';
import type { RemoteDevice } from '../types';
import { styles } from './styles';

export function ChatDevices({ devices, choose, onClose }: {
  devices: RemoteDevice[]; choose: (id: string) => void; onClose: () => void;
}) {
  return <BottomSheet visible title="选择电脑" onClose={onClose}>
    <ScrollView contentContainerStyle={styles.settings}>
      {devices.map((device) => <Pressable key={device.deviceId} accessibilityRole="button"
        style={[styles.card, !device.online && styles.disabled]} disabled={!device.online}
        onPress={() => choose(device.deviceId)}>
        <View style={styles.row}><Text style={[styles.title, styles.fill]}>{device.name}</Text>
          <Text style={styles.subtitle}>{device.online ? '在线' : '离线'}</Text></View>
      </Pressable>)}
      {!devices.length && <Text style={styles.subtitle}>在电脑上打开 Codex Switch 并登录同一账号，即可开始聊天。</Text>}
    </ScrollView>
  </BottomSheet>;
}
