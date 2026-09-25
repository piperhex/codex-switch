import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View, useWindowDimensions } from 'react-native';
import type { GitClient } from '../../../../../shared/remote-chat/gitTypes';
import { useGitDiff, useRemoteGit, type RemoteGit } from '../../../../../shared/remote-chat/useRemoteGit';
import { BottomSheet } from '../../components/BottomSheet';
import { GitHistory } from './GitHistory';
import { gitStyles as styles } from './styles';
import { palette } from '../styles';

interface Props {
  client: GitClient; cwd: string; active: boolean; connected: boolean; deviceName?: string; onClose: () => void;
}

export function ChatGit(props: Props) {
  const panel = useRemoteGit(props);
  const diff = useGitDiff(props.client, props.cwd, panel.detail, props.active && props.connected);
  const { height } = useWindowDimensions();
  return <BottomSheet visible={props.active} title="Git" subtitle={props.deviceName} onClose={props.onClose}
    onBack={panel.detail ? () => panel.setDetail(null) : undefined} tall dragFromHeaderOnly fullWidthContent>
    <View style={{ height: height * .72, flexShrink: 1 }}>
      <View style={styles.toolbar}><Text style={styles.branch}>{panel.changes?.branch ?? 'Git 仓库'}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="刷新 Git"
          disabled={panel.busy || !props.connected || !props.cwd} style={styles.button}
          onPress={() => { panel.setDetail(null); void panel.refresh(); }}><Text style={styles.buttonText}>刷新</Text>
        </Pressable></View>
      <Text numberOfLines={1} style={styles.project}>{panel.changes?.root ?? props.cwd}</Text>
      {!props.cwd && <Text style={styles.notice}>请先选择一个项目。</Text>}
      {!props.connected && <Text style={styles.notice}>电脑连接后即可使用 Git。</Text>}
      {!!panel.error && <Text accessibilityRole="alert" style={styles.error}>{panel.error}</Text>}
      {panel.changes?.files.some(file => file.conflict) && <Text style={styles.error}>
        请先在电脑上解决冲突或完成正在进行的合并。</Text>}
      {!!panel.notice && <Text accessibilityRole="alert" style={styles.notice}>已提交 {panel.notice}</Text>}
      {panel.detail ? <>
        <Text numberOfLines={2} style={styles.detailTitle}>{panel.detail.title}</Text>
        {!!diff.error && <Text accessibilityRole="alert" style={styles.error}>{diff.error}</Text>}
        {!diff.value && !diff.error && props.connected && <ActivityIndicator color={palette.green} />}
        {diff.value && <ScrollView style={styles.fill}>
          {diff.value.truncated && <Text style={styles.notice}>差异较大，仅显示部分内容。</Text>}
          <ScrollView horizontal><Text selectable style={styles.diff}>{diff.value.text
            ? diff.value.text.split('\n').map((line, index) => <Text key={index}
              style={line[0] === '+' ? styles.added : line[0] === '-' ? styles.removed : undefined}>
              {line}{'\n'}</Text>) : '没有可显示的文本差异。'}</Text></ScrollView>
        </ScrollView>}
      </> : <>
        <View style={styles.tabs}>
          <Pressable accessibilityRole="tab" accessibilityState={{ selected: panel.tab === 'changes' }}
            style={[styles.tab, panel.tab === 'changes' && styles.selectedTab]} onPress={() => panel.setTab('changes')}>
            <Text style={styles.buttonText}>改动 {panel.changes?.files.length ?? 0}</Text></Pressable>
          <Pressable accessibilityRole="tab" accessibilityState={{ selected: panel.tab === 'history' }}
            style={[styles.tab, panel.tab === 'history' && styles.selectedTab]} onPress={() => panel.setTab('history')}>
            <Text style={styles.buttonText}>提交记录</Text></Pressable>
        </View>
        {panel.busy && <ActivityIndicator style={styles.loading} color={palette.green} />}
        {panel.tab === 'changes' ? <GitChanges panel={panel} connected={props.connected} />
          : <GitHistory panel={panel} connected={props.connected} />}
      </>}
    </View>
  </BottomSheet>;
}

function GitChanges({ panel, connected }: { panel: RemoteGit; connected: boolean }) {
  const files = panel.changes?.files ?? [];
  const count = Object.keys(panel.selected).length;
  const selectable = files.filter(file => !file.conflict);
  const all = selectable.length > 0 && count === selectable.length;
  return <>
    <View style={styles.selection}>
      <Pressable accessibilityRole="checkbox" accessibilityLabel="全选" accessibilityState={{ checked: all }}
        disabled={panel.busy || !selectable.length} onPress={panel.selectAll} style={styles.checkButton}>
        <Text style={styles.check}>{all ? '☑' : '☐'}</Text><Text style={styles.meta}>全选</Text></Pressable>
      <Text style={styles.meta}>已选 {count} 个文件</Text></View>
    <ScrollView style={styles.fill} keyboardShouldPersistTaps="handled">
      {panel.changes && !files.length && <Text style={styles.notice}>工作区没有未提交的改动。</Text>}
      {files.map(file => <View key={file.path} style={styles.file}>
        <Pressable accessibilityRole="checkbox" accessibilityLabel={`选择 ${file.path}`}
          accessibilityState={{ checked: !!panel.selected[file.path], disabled: file.conflict || panel.busy }}
          disabled={file.conflict || panel.busy} onPress={() => panel.toggle(file)} style={styles.checkButton}>
          <Text style={[styles.check, file.conflict && styles.disabled]}>{panel.selected[file.path] ? '☑' : '☐'}</Text>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel={`查看 ${file.path}`} disabled={!connected || panel.busy}
          style={styles.fileButton} onPress={() => panel.setDetail({ path: file.path, title: file.path })}>
          <Text style={[styles.status, file.conflict && styles.conflict]}>
            {file.conflict ? '冲突' : file.status.trim()}</Text>
          <View style={styles.fill}><Text style={styles.path}>{file.path}</Text>
            {file.originalPath && <Text style={styles.meta}>{file.originalPath} → {file.path}</Text>}</View>
        </Pressable></View>)}
    </ScrollView>
    <View style={styles.form}>
      <TextInput accessibilityLabel="提交说明" placeholder="填写提交说明" placeholderTextColor={palette.muted}
        style={styles.input} multiline maxLength={4000} value={panel.message} editable={!panel.busy}
        onChangeText={panel.setMessage} />
      <Text style={styles.hint}>提交所选文件的全部改动，包含已暂存和未暂存的内容。</Text>
      <Pressable accessibilityRole="button" disabled={!panel.canCommit}
        style={[styles.submit, !panel.canCommit && styles.disabled]} onPress={() => void panel.commit()}>
        <Text style={styles.submitText}>提交 {count} 个文件</Text></Pressable>
    </View>
  </>;
}
