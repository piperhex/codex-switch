import { Ionicons } from '@expo/vector-icons';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import type { DownloadTask } from './types';
import { downloadDetail, downloadPercent, downloadStatus, formatBytes } from './presentation';
import { colors, styles } from './styles';

export function DownloadCard({ task, connected, busy, action, remove }: {
  task: DownloadTask; connected: boolean; busy: boolean;
  action: () => void; remove: () => void;
}) {
  const active = task.status === 'downloading' || task.status === 'queued';
  const complete = task.status === 'completed';
  const paused = task.status === 'paused';
  const failed = task.status === 'failed';
  const disabled = busy || (!connected && !active && !complete);
  const label = active ? '暂停' : complete ? '打开文件' : '继续下载';
  const icon = active ? 'pause-outline' : complete ? 'open-outline' : 'play-outline';
  const percent = downloadPercent(task);
  return <View style={styles.card}>
    <View style={styles.cardHeader}>
      <View style={styles.fileIcon}><Ionicons name="document-text-outline" size={23} color={colors.green} /></View>
      <View style={styles.fileCopy}>
        <Text style={styles.title} numberOfLines={2}>{task.name}</Text>
        <Text style={styles.caption} numberOfLines={1}>{task.source.deviceName}</Text>
      </View>
    </View>
    <View style={styles.progressCopy}>
      <View style={styles.statusRow}>
        <View style={[styles.statusBadge, paused && styles.pausedBadge, failed && styles.failedBadge]}>
          <Text style={[styles.status, paused && styles.paused, failed && styles.danger]}>
            {downloadStatus[task.status]}</Text>
        </View>
        <Text style={styles.caption}>{complete ? formatBytes(task.size) : `${percent}%`}</Text>
      </View>
      {!complete && <>
        <View accessibilityRole="progressbar" accessibilityLabel={`${task.name}下载进度`}
          accessibilityValue={{ min: 0, max: 100, now: percent }} style={styles.track}>
          <View style={[styles.progress, paused && styles.pausedProgress, failed && styles.failedProgress,
            { width: `${percent}%` }]} />
        </View>
        <Text style={styles.caption}>{downloadDetail(task)}</Text>
      </>}
    </View>
    {!!task.message && <Text style={failed ? styles.error : styles.text}>{task.message}</Text>}
    {!connected && !complete && <Text style={styles.text}>连接这台电脑后即可继续。</Text>}
    <View style={[styles.toolbar, styles.cardActions]}>
      <Pressable accessibilityRole="button" accessibilityLabel="删除" disabled={busy} onPress={remove}
        style={({ pressed }) => [styles.deleteButton, busy && styles.disabled, pressed && styles.pressed]}>
        <Ionicons name="trash-outline" size={16} color={colors.muted} />
        <Text style={styles.deleteText}>删除</Text>
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled, busy }}
        disabled={disabled} onPress={action}
        style={({ pressed }) => [styles.button, disabled && styles.disabled, pressed && styles.pressed]}>
        {busy ? <ActivityIndicator size="small" color={colors.green} />
          : <Ionicons name={icon} size={16} color={colors.green} />}
        <Text style={styles.buttonText}>{label}</Text>
      </Pressable>
    </View>
  </View>;
}
