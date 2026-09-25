import { Ionicons } from '@expo/vector-icons';
import { Pressable, Text, View } from 'react-native';
import type { DownloadConnection } from './types';
import { colors, styles } from './styles';

function SourceCard({ scope, disabled, onPress }: {
  scope: 'project' | 'computer'; disabled: boolean; onPress: () => void;
}) {
  const project = scope === 'project';
  return <Pressable accessibilityRole="button" accessibilityLabel={project ? '当前项目' : '此电脑'}
    accessibilityState={{ disabled }} disabled={disabled} onPress={onPress}
    style={({ pressed }) => [styles.sourceCard, disabled && styles.disabled, pressed && styles.pressed]}>
    <View style={[styles.sourceIcon, !project && styles.computerIcon]}>
      <Ionicons name={project ? 'folder-outline' : 'desktop-outline'} size={23}
        color={project ? colors.green : colors.blue} />
    </View>
    <View style={styles.sourceCopy}>
      <Text style={styles.sourceTitle}>{project ? '当前项目' : '此电脑'}</Text>
      <Text style={styles.caption}>{project ? '浏览项目文件' : '浏览电脑文件'}</Text>
    </View>
    <Ionicons name="chevron-forward" size={16} color={colors.muted} style={styles.sourceChevron} />
  </Pressable>;
}

export function DownloadSources({ connection, browse }: {
  connection?: DownloadConnection; browse: (scope: 'project' | 'computer') => void;
}) {
  const ready = !!connection?.ready;
  const canBrowseProject = ready && !!(connection.cwd || connection.threadId);
  let hint = '离开此页面后，下载仍会继续。';
  if (!ready) hint = '先在聊天中连接电脑，即可添加下载。';
  else if (!canBrowseProject) hint = '在聊天中选择项目，或从此电脑添加下载。';
  return <View style={styles.sources}>
    <View style={styles.connection}>
      <View style={[styles.connectionDot, !ready && styles.offlineDot]} />
      <Text style={styles.connectionName} numberOfLines={1}>{connection?.deviceName || '尚未连接电脑'}</Text>
      <Text style={styles.caption}>{ready ? '已连接' : '未连接'}</Text>
    </View>
    <Text style={styles.sectionLabel}>添加下载</Text>
    <View style={styles.sourceRow}>
      <SourceCard scope="project" disabled={!canBrowseProject} onPress={() => browse('project')} />
      <SourceCard scope="computer" disabled={!ready} onPress={() => browse('computer')} />
    </View>
    <View style={styles.hint}>
      <Ionicons name="information-circle-outline" size={15} color={colors.muted} />
      <Text style={styles.hintText}>{hint}</Text>
    </View>
  </View>;
}
