import { Ionicons } from '@expo/vector-icons';
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import type { RemoteDevice } from '../types';
import { deviceColors, styles } from './styles';

interface DeviceOptionsMenuProps {
  device: RemoteDevice | null;
  deletingDeviceId: string | null;
  switchingAuthDeviceId: string | null;
  onClose: () => void;
  onDelete: (device: RemoteDevice) => void;
  onRevokeService: (device: RemoteDevice) => void;
  onSelectAuthAccount: (deviceId: string) => void;
}

export function DeviceOptionsMenu(props: DeviceOptionsMenuProps) {
  const { device, deletingDeviceId, switchingAuthDeviceId, onClose, onDelete, onSelectAuthAccount } = props;
  if (!device) return null;
  const deleteDisabled = device.online || Boolean(deletingDeviceId);
  const authDisabled = !device.online || Boolean(switchingAuthDeviceId);
  return <Modal transparent visible animationType="fade" onRequestClose={onClose}>
    <View style={styles.overlay}>
      <Pressable accessibilityLabel="关闭菜单" accessibilityRole="button"
        style={StyleSheet.absoluteFill} onPress={onClose} />
      <View style={styles.menu} accessibilityViewIsModal>
        <View style={styles.menuHeader}>
          <Text style={styles.menuTitle}>{device.name}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="关闭菜单" onPress={onClose} style={styles.close}>
            <Ionicons name="close" size={22} color={deviceColors.muted} />
          </Pressable>
        </View>
        <Pressable accessibilityRole="button" accessibilityState={{ disabled: authDisabled }} disabled={authDisabled}
          onPress={() => { onClose(); onSelectAuthAccount(device.deviceId); }}
          style={({ pressed }) => [styles.option, pressed && styles.pressed, authDisabled && styles.disabled]}>
          <Ionicons name="open-outline" size={21} color={deviceColors.green} />
          <Text style={styles.optionLabel}>代理登录态账号</Text>
          {switchingAuthDeviceId === device.deviceId && <ActivityIndicator color={deviceColors.green} />}
        </Pressable>
        {device.platform.toLowerCase() === 'windows' && <Pressable accessibilityRole="button"
          onPress={() => { onClose(); props.onRevokeService(device); }} style={styles.option}>
          <Ionicons name="lock-closed-outline" size={21} color={deviceColors.danger} />
          <Text style={[styles.optionLabel, styles.danger]}>撤销无人值守授权</Text>
        </Pressable>}
        <Pressable accessibilityRole="button"
          accessibilityState={{ disabled: deleteDisabled }} disabled={deleteDisabled}
          onPress={() => { onClose(); onDelete(device); }}
          style={({ pressed }) => [styles.option, pressed && styles.pressed, deleteDisabled && styles.disabled]}>
          <Ionicons name="trash-outline" size={21} color={deviceColors.danger} />
          <Text style={[styles.optionLabel, styles.danger]}>{device.online ? '在线不可删除' : '删除设备'}</Text>
          {deletingDeviceId === device.deviceId && <ActivityIndicator color={deviceColors.danger} />}
        </Pressable>
        {!device.online && <Text style={styles.hintText}>设备上线后可更换代理登录态账号。</Text>}
      </View>
    </View>
  </Modal>;
}
