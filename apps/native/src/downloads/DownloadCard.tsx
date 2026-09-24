import { Pressable, Text, View } from 'react-native';
import type { DownloadTask } from './types';
import { downloadDetail, downloadPercent, downloadStatus } from './presentation';
import { styles } from './styles';

export function DownloadCard({ task, connected, busy, action, remove }: {
  task: DownloadTask; connected: boolean; busy: boolean;
  action: () => void; remove: () => void;
}) {
  const active = task.status === 'downloading' || task.status === 'queued';
  const complete = task.status === 'completed';
  const disabled = busy || (!connected && !active && !complete);
  const label = active ? '暂停' : complete ? '打开文件' : '继续下载';
  return <View style={styles.card}>
    <Text style={styles.title} numberOfLines={2}>{task.name}</Text>
    <Text style={styles.text} numberOfLines={1}>{task.source.deviceName}</Text>
    <Text style={styles.text}>{downloadStatus[task.status]} · {downloadDetail(task)}</Text>
    <View accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: downloadPercent(task) }}
      style={styles.track}><View style={[styles.progress, { width: `${downloadPercent(task)}%` }]} /></View>
    {!!task.message && <Text style={task.status === 'failed' ? styles.error : styles.text}>{task.message}</Text>}
    {!connected && !complete && <Text style={styles.text}>连接这台电脑后即可继续。</Text>}
    <View style={styles.toolbar}>
      <Pressable accessibilityRole="button" disabled={disabled} onPress={action}
        style={[styles.button, disabled && styles.disabled]}>
        <Text style={styles.buttonText}>{label}</Text></Pressable>
      <Pressable accessibilityRole="button" disabled={busy} onPress={remove} style={styles.button}>
        <Text style={[styles.buttonText, styles.danger]}>删除</Text></Pressable>
    </View>
  </View>;
}
