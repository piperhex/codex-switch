import { useEffect, useState, useSyncExternalStore } from 'react';
import { Pressable, Text, View } from 'react-native';
import { BottomSheet } from '../components/BottomSheet';
import { SheetFlatList, SheetInset } from '../components/SheetScrollView';
import { downloadManager, downloadOwner } from './manager';
import { DownloadBrowser } from './DownloadBrowser';
import { DownloadCard } from './DownloadCard';
import type { AuthSession } from '../types';
import type { DownloadTask } from './types';
import { styles } from './styles';

export function DownloadManagerSheet({ session, close }: { session: AuthSession; close: () => void }) {
  const tasks = useSyncExternalStore(downloadManager.subscribe, downloadManager.snapshot);
  const connection = useSyncExternalStore(downloadManager.subscribe, downloadManager.connection);
  const initializationError = useSyncExternalStore(downloadManager.subscribe, downloadManager.error);
  const [view, setView] = useState<'tasks' | 'project' | 'computer'>('tasks');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [deleting, setDeleting] = useState<DownloadTask>();
  const owner = downloadOwner(session);
  const current = connection?.owner === owner ? connection : undefined;
  const canBrowseProject = !!current?.ready && !!(current.cwd || current.threadId);
  let hint = '关闭此窗口后，下载会继续。';
  if (!current?.ready) hint = '请先在聊天中连接电脑，即可浏览和下载文件。';
  else if (!canBrowseProject) hint = '请先在聊天中选择项目，或从此电脑浏览文件。';
  useEffect(() => { void downloadManager.initialize(); }, []);
  const run = async (task: DownloadTask, operation: 'action' | 'delete') => {
    if (busy) return;
    setBusy(task.id); setError('');
    try {
      if (operation === 'delete') { await downloadManager.delete(task.id); setDeleting(undefined); }
      else if (task.status === 'completed') await downloadManager.open(task);
      else if (task.status === 'queued' || task.status === 'downloading') await downloadManager.pause(task.id);
      else await downloadManager.resume(task.id);
    } catch {
      setError(operation === 'delete' ? '删除未完成，请检查文件是否仍可访问后重试。'
        : '操作未完成，请检查电脑连接、存储空间或是否有可打开此文件的应用。');
    } finally { setBusy(''); }
  };
  return <>
    <BottomSheet visible tall fullWidthContent title="下载管理" subtitle={current?.deviceName}
      onClose={close} dragFromHeaderOnly>
      {view !== 'tasks' && current ? <DownloadBrowser
        key={`${current.deviceId}:${view}:${current.threadId ?? current.cwd ?? ''}`}
        connection={current} scope={view} back={() => setView('tasks')} /> : <View style={styles.content}>
        <SheetInset style={styles.readable}>
          <View style={styles.toolbar}>
            <Pressable accessibilityRole="button" disabled={!canBrowseProject}
              onPress={() => setView('project')} style={[styles.button, !canBrowseProject && styles.disabled]}>
              <Text style={styles.buttonText}>当前项目</Text></Pressable>
            <Pressable accessibilityRole="button" disabled={!current?.ready}
              onPress={() => setView('computer')} style={[styles.button, !current?.ready && styles.disabled]}>
              <Text style={styles.buttonText}>此电脑</Text></Pressable>
          </View>
          <Text style={styles.text}>{hint}</Text>
          {!!(error || initializationError) && <Text accessibilityRole="alert"
            style={styles.error}>{error || initializationError}</Text>}
        </SheetInset>
        <SheetFlatList data={tasks.filter(task => task.source.owner === owner).slice().reverse()}
          keyExtractor={task => task.id} style={styles.list} contentContainerStyle={styles.readable}
          renderItem={({ item }) => <DownloadCard task={item} busy={busy === item.id}
            connected={!!current?.ready && current.deviceId === item.source.deviceId}
            action={() => { void run(item, 'action'); }} remove={() => setDeleting(item)} />}
          ListEmptyComponent={<Text style={[styles.text, { paddingVertical: 28 }]}>
            暂无下载。可从聊天文件、当前项目或此电脑添加。</Text>} />
      </View>}
    </BottomSheet>
    <BottomSheet visible={!!deleting} title="删除下载" onClose={() => { if (!busy) setDeleting(undefined); }}
      actions={[
        { label: '保留', disabled: !!busy, onPress: () => setDeleting(undefined) },
        { label: '删除', tone: 'danger', disabled: !!busy,
          onPress: () => { if (deleting) void run(deleting, 'delete'); } },
      ]}>
      <Text style={styles.text}>将删除手机上的文件和下载记录，电脑上的原文件会保留。</Text>
      {!!error && <Text style={styles.error}>{error}</Text>}
    </BottomSheet>
  </>;
}
