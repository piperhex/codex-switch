import { ActivityIndicator, Pressable, ScrollView, Text, View, useWindowDimensions } from 'react-native';
import type { GitClient } from '../../../../../shared/remote-chat/gitTypes';
import { useGitDiff, useRemoteGit } from '../../../../../shared/remote-chat/useRemoteGit';
import { BottomSheet } from '../../components/BottomSheet';
import { GitHistory } from './GitHistory';
import { GitChanges } from './GitChanges';
import { GitToolbar } from './GitToolbar';
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
      <GitToolbar panel={panel} connected={props.connected} />
      <Text numberOfLines={1} style={styles.project}>{panel.changes?.root ?? props.cwd}</Text>
      {!props.cwd && <Text style={styles.notice}>请先选择一个项目。</Text>}
      {!props.connected && <Text style={styles.notice}>电脑连接后即可使用 Git。</Text>}
      {!!panel.error && <Text accessibilityRole="alert" style={styles.error}>{panel.error}</Text>}
      {panel.changes?.files.some(file => file.conflict) && <Text style={styles.error}>
        请先在电脑上解决冲突或完成正在进行的合并。</Text>}
      {!!panel.notice && <Text accessibilityRole="alert" style={styles.notice}>{panel.notice}</Text>}
      {panel.busy && <ActivityIndicator style={styles.loading} color={palette.green} />}
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
        {panel.tab === 'changes' ? <GitChanges panel={panel} connected={props.connected} />
          : <GitHistory panel={panel} connected={props.connected} />}
      </>}
    </View>
  </BottomSheet>;
}
