import { useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import type { RemoteGit } from '../../../../../shared/remote-chat/useRemoteGit';
import type { GitAction } from '../../../../../shared/remote-chat/gitTypes';
import { GIT_ACTIONS } from '../../../../../shared/remote-chat/gitActions';
import { gitStyles as styles } from './styles';

export function GitToolbar({ panel, connected }: { panel: RemoteGit; connected: boolean }) {
  const [menu, setMenu] = useState<'branches' | 'actions' | null>(null);
  const [query, setQuery] = useState('');
  const [action, setAction] = useState<Exclude<GitAction, 'switch'>>('update');
  const disabled = panel.busy || !connected || !panel.changes;
  const repository = panel.repository;
  const actionDisabled = disabled || !repository?.remotes.length || (action !== 'fetch' && !repository.upstream)
    || ((action === 'pull' || action === 'update') && !!panel.changes?.files.length);
  return <>
    <View style={styles.toolbar}>
      <Pressable accessibilityRole="button" accessibilityLabel="切换分支" disabled={disabled}
        style={[styles.branchButton, disabled && styles.disabled]}
        onPress={() => setMenu(menu === 'branches' ? null : 'branches')}>
        <Text numberOfLines={1} style={styles.branch}>{panel.changes?.branch ?? '分离的 HEAD'} ▾</Text></Pressable>
      <Pressable accessibilityRole="button" disabled={disabled} style={styles.button}
        onPress={() => setMenu(menu === 'actions' ? null : 'actions')}><Text style={styles.buttonText}>同步</Text>
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel="刷新 Git" disabled={disabled} style={styles.button}
        onPress={() => { panel.setDetail(null); void panel.refresh(); }}><Text style={styles.buttonText}>刷新</Text>
      </Pressable>
    </View>
    {!!repository?.upstream && <Text style={styles.tracking}>
      {repository.upstream}   ↑ {repository.ahead} · ↓ {repository.behind}</Text>}
    {menu && <View style={styles.menu}>
      <View style={styles.menuHeading}><Text style={styles.areaTitle}>{menu === 'branches' ? '切换分支' : '同步项目'}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="关闭菜单" style={styles.button}
          onPress={() => setMenu(null)}><Text style={styles.buttonText}>关闭</Text></Pressable></View>
      <ScrollView style={styles.menuScroll} keyboardShouldPersistTaps="handled" nestedScrollEnabled>
        {menu === 'branches' ? <>
          <TextInput accessibilityLabel="搜索分支" placeholder="搜索分支" style={styles.search}
            value={query} onChangeText={setQuery} />
          {repository?.branches.filter(branch => branch.name.includes(query)).map(branch => {
            const current = !branch.remote && branch.name === panel.changes?.branch;
            return <Pressable key={branch.ref} accessibilityRole="button" accessibilityLabel={`切换到 ${branch.name}`}
              disabled={disabled || branch.occupied || current} style={styles.branchRow}
              onPress={() => { setMenu(null); void panel.action('switch', branch.ref); }}>
              <Text style={[styles.path, (branch.occupied || current) && styles.disabled]}>{branch.name}</Text>
              <Text style={styles.meta}>{branch.occupied ? '其他工作树使用中' : branch.remote ? '远程' : '本地'}
                {current ? ' ✓' : ''}</Text></Pressable>;
          })}
          <Text style={styles.menuHint}>选择远程分支会创建同名本地分支。</Text>
        </> : <>
          <View style={styles.actionOptions}>{GIT_ACTIONS.map(item => <Pressable key={item.action}
            accessibilityRole="button" accessibilityState={{ selected: action === item.action }}
            style={[styles.actionButton, action === item.action && styles.activeMode]}
            onPress={() => setAction(item.action)}>
            <Text style={styles.buttonText}>{item.label}</Text></Pressable>)}</View>
          <Text style={styles.menuHint}>{GIT_ACTIONS.find(item => item.action === action)!.hint}</Text>
          <Text style={styles.menuHint}>当前分支：{panel.changes?.branch ?? 'HEAD'}{'\n'}
            跟踪分支：{repository?.upstream ?? '未设置'}</Text>
          {(action === 'pull' || action === 'update') && <>
            <View style={styles.actionOptions}>{(['merge', 'rebase'] as const).map(strategy =>
              <Pressable key={strategy} accessibilityRole="button"
                accessibilityState={{ selected: panel.strategy === strategy }}
                style={[styles.actionButton, panel.strategy === strategy && styles.activeMode]}
                onPress={() => panel.setStrategy(strategy)}><Text style={styles.buttonText}>
                  {strategy === 'merge' ? '合并 Merge' : '变基 Rebase'}</Text></Pressable>)}</View>
            {!!panel.changes?.files.length && <Text style={styles.menuHint}>
              请先提交本地改动，再拉取或更新项目。</Text>}
          </>}
          {!repository?.remotes.length && <Text style={styles.menuHint}>项目还没有远程仓库，请先在电脑上添加。</Text>}
          <Pressable accessibilityRole="button" disabled={actionDisabled}
            style={[styles.submit, { marginTop: 10 }, actionDisabled && styles.disabled]}
            onPress={() => { setMenu(null); void panel.action(action); }}>
            <Text style={styles.submitText}>执行 {GIT_ACTIONS.find(item => item.action === action)!.label}</Text>
          </Pressable>
        </>}
      </ScrollView>
    </View>}
  </>;
}
