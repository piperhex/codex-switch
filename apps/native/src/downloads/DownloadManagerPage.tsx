import { useEffect, useState } from 'react';
import { BackHandler, FlatList, Text, View } from 'react-native';
import { BottomSheet } from '../components/BottomSheet';
import type { AuthSession } from '../types';
import { DownloadBrowser } from './DownloadBrowser';
import { DownloadCard } from './DownloadCard';
import { DownloadEmptyState } from './DownloadEmptyState';
import { DownloadPageHeader } from './DownloadPageHeader';
import { DownloadSources } from './DownloadSources';
import { useDownloadTasks } from './useDownloadTasks';
import { styles } from './styles';

export function DownloadManagerPage({ session, onBack }: { session: AuthSession; onBack: () => void }) {
  const state = useDownloadTasks(session);
  const [view, setView] = useState<'tasks' | 'project' | 'computer'>('tasks');
  const { tasks, connection, busy, deleting, error, run, setDeleting } = state;
  const browsing = view !== 'tasks' && !!connection;
  useEffect(() => {
    if (browsing) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => { onBack(); return true; });
    return () => subscription.remove();
  }, [browsing, onBack]);

  if (view !== 'tasks' && connection) return <DownloadBrowser
    key={`${connection.deviceId}:${view}:${connection.threadId ?? connection.cwd ?? ''}`}
    connection={connection} scope={view} back={() => setView('tasks')} />;

  return <View style={styles.page}>
    <DownloadPageHeader title="下载管理" back={onBack} backLabel="返回设置" />
    <FlatList data={tasks} keyExtractor={task => task.id} style={styles.list}
      contentContainerStyle={styles.listContent} showsVerticalScrollIndicator={false}
      ListHeaderComponent={<>
        <DownloadSources connection={connection} browse={setView} />
        {!!error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
        <View style={styles.sectionHeading}>
          <Text style={styles.sectionTitle}>下载任务</Text>
          <Text style={styles.count}>{tasks.length} 项</Text>
        </View>
      </>}
      renderItem={({ item }) => <DownloadCard task={item} busy={busy === item.id}
        connected={!!connection?.ready && connection.deviceId === item.source.deviceId}
        action={() => { void run(item, 'action'); }} remove={() => setDeleting(item)} />}
      ListEmptyComponent={<DownloadEmptyState />} />
    <BottomSheet visible={!!deleting} title="删除下载" dismissible={!busy}
      onClose={() => { if (!busy) setDeleting(undefined); }} actions={[
        { label: '保留', disabled: !!busy, onPress: () => setDeleting(undefined) },
        { label: '删除', tone: 'danger', disabled: !!busy,
          onPress: () => { if (deleting) void run(deleting, 'delete'); } },
      ]}>
      <Text style={styles.text}>将删除手机上的文件和下载记录，电脑上的原文件会保留。</Text>
      {!!error && <Text style={styles.error}>{error}</Text>}
    </BottomSheet>
  </View>;
}
