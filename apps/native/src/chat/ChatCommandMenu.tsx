import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import type { Skill } from './types';
import { skillDescription, skillLabel, type SkillCatalogState } from './skillCatalog';
import { palette, styles } from './styles';

interface Props {
  catalog: SkillCatalogState;
  query: string;
  skillsOnly: boolean;
  compactReason: string | null;
  choose: (skill: Skill) => void;
  compact: () => void;
  close: () => void;
}

export function ChatCommandMenu({ catalog, query, skillsOnly, compactReason, choose, compact, close }: Props) {
  const search = query.toLocaleLowerCase();
  const skills = catalog.skills.filter((skill) =>
    `${skill.name} ${skillLabel(skill)} ${skillDescription(skill)}`.toLocaleLowerCase().includes(search));
  const showCompact = !skillsOnly && 'compact 压缩 上下文'.includes(search);
  return <View style={menuStyles.panel} accessibilityLabel="命令和技能">
    <View style={menuStyles.heading}>
      <Text style={styles.buttonText}>命令和技能</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="关闭命令和技能" onPress={close} hitSlop={8}>
        <Text style={styles.buttonText}>×</Text>
      </Pressable>
    </View>
    <FlatList data={skills} keyExtractor={(skill) => skill.path} style={menuStyles.list}
      keyboardShouldPersistTaps="always" nestedScrollEnabled
      ListHeaderComponent={showCompact ? <Pressable accessibilityRole="button" accessibilityLabel="压缩上下文"
        disabled={compactReason !== null} accessibilityState={{ disabled: compactReason !== null }}
        onPress={compact} style={[menuStyles.option, compactReason !== null && styles.disabled]}>
        <Text style={styles.buttonText}>压缩 <Text style={styles.subtitle}>/compact</Text></Text>
        <Text style={styles.subtitle}>{compactReason ?? '压缩此对话的上下文'}</Text>
      </Pressable> : null}
      renderItem={({ item: skill }) => <Pressable accessibilityRole="button"
        accessibilityLabel={`使用技能 ${skillLabel(skill)}`} disabled={!skill.enabled}
        accessibilityState={{ disabled: !skill.enabled }} onPress={() => choose(skill)}
        style={[menuStyles.option, !skill.enabled && styles.disabled]}>
        <Text style={styles.buttonText}>{skillLabel(skill)}{!skill.enabled && '（已停用）'}</Text>
        <Text numberOfLines={2} style={styles.subtitle}>{skillDescription(skill)}</Text>
      </Pressable>}
      ListFooterComponent={<>
        {!catalog.loaded && catalog.loading && <Text style={menuStyles.message}>正在加载技能…</Text>}
        {!!catalog.error && <Text style={menuStyles.message}>{catalog.error}</Text>}
        {catalog.loaded && !skills.length && !showCompact
          && <Text style={menuStyles.message}>没有找到匹配的命令或技能</Text>}
      </>} />
  </View>;
}

const menuStyles = StyleSheet.create({
  panel: { width: '100%', maxWidth: 400, alignSelf: 'center', borderWidth: 1,
    borderColor: palette.border, borderRadius: 14, overflow: 'hidden', backgroundColor: '#fff' },
  heading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 12 },
  list: { maxHeight: 220, flexGrow: 0 },
  option: { paddingHorizontal: 12, paddingVertical: 10, gap: 4, borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: palette.border },
  message: { color: palette.muted, padding: 12, fontSize: 12, lineHeight: 18 },
});
