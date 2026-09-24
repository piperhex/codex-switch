import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { DownloadBrowse } from '../../../../shared/remote-chat/downloads';
import type { ProjectFile, ProjectFilesResponse } from '../../../../shared/remote-chat/projectFiles';
import { SheetFlatList, SheetInset } from '../components/SheetScrollView';
import { downloadManager } from './manager';
import type { DownloadConnection } from './types';
import { styles } from './styles';

export function DownloadBrowser({ connection, scope, back }: {
  connection: DownloadConnection; scope: DownloadBrowse['scope']; back: () => void;
}) {
  const [directory, setDirectory] = useState('');
  const [result, setResult] = useState<ProjectFilesResponse>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [revision, setRevision] = useState(0);
  const [adding, setAdding] = useState(false);
  const { client, ready, threadId, cwd } = connection;
  useEffect(() => {
    let cancelled = false;
    setError(''); setResult(undefined);
    if (!ready) { setLoading(false); return; }
    setLoading(true);
    void client.browse({ scope, directory, threadId, cwd })
      .then(value => { if (!cancelled) setResult(value); })
      .catch(() => { if (!cancelled) setError('无法读取文件夹，请确认电脑已更新并连接后重试。'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [client, ready, scope, directory, threadId, cwd, revision]);
  const choose = async (file: ProjectFile) => {
    setNotice('');
    if (file.directory) { setDirectory(file.path); return; }
    if (adding) return;
    setAdding(true);
    try {
      await downloadManager.enqueue({ owner: connection.owner, deviceId: connection.deviceId,
        deviceName: connection.deviceName, scope, threadId, cwd, path: file.path });
      setNotice('已加入下载管理。');
    } catch (cause) { setError(cause instanceof Error ? cause.message : '暂时无法下载，请重试。'); }
    finally { setAdding(false); }
  };
  return <View style={styles.content}>
    <SheetInset style={styles.readable}>
      <View style={styles.toolbar}>
        <Pressable accessibilityRole="button" onPress={back} style={styles.button}>
          <Text style={styles.buttonText}>下载列表</Text></Pressable>
        {result?.parent != null && <Pressable accessibilityRole="button" disabled={loading}
          onPress={() => setDirectory(result.parent ?? '')} style={styles.button}>
          <Text style={styles.buttonText}>上一级</Text></Pressable>}
      </View>
      <Text style={styles.text}>{result?.directory || (scope === 'computer' ? '此电脑' : '当前项目')}</Text>
      {!ready && <Text style={styles.error}>请连接这台电脑后浏览文件。</Text>}
      {!!notice && <Text accessibilityLiveRegion="polite" style={styles.message}>{notice}</Text>}
      {!!error && <Pressable accessibilityRole="button" accessibilityLabel="重试读取文件夹"
        onPress={() => setRevision(value => value + 1)}><Text style={styles.error}>{error}</Text></Pressable>}
      {loading && <ActivityIndicator accessibilityLabel="正在读取文件夹" />}
    </SheetInset>
    <SheetFlatList data={result?.entries ?? []} keyExtractor={file => file.path}
      style={styles.list} contentContainerStyle={styles.readable}
      renderItem={({ item }) => <Pressable accessibilityRole="button" disabled={adding || !ready}
        accessibilityLabel={`${item.directory ? '打开文件夹' : '下载'}：${item.name}`}
        onPress={() => { void choose(item); }} style={styles.row}>
        <Ionicons name={item.directory ? 'folder-outline' : 'document-outline'} size={23} color="#087f69" />
        <Text style={styles.name} numberOfLines={2}>{item.name}</Text>
        <Ionicons name={item.directory ? 'chevron-forward' : 'download-outline'} size={20} color="#6f8177" />
      </Pressable>}
      ListEmptyComponent={!loading && !error && ready ? <Text style={styles.text}>此文件夹没有文件。</Text> : null}
      ListFooterComponent={result?.truncated ? <Text style={styles.text}>文件较多，仅显示前 500 项。</Text> : null} />
  </View>;
}
