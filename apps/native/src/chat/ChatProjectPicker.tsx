import Feather from '@expo/vector-icons/Feather';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { BottomSheet } from '../components/BottomSheet';
import { directoryProject, type ProjectPickerProps } from '../../../../shared/remote-chat/projectDirectories';
import { useProjectDirectories } from '../../../../shared/remote-chat/client/useProjectDirectories';

export function ChatProjectPicker(props: ProjectPickerProps) {
  const { result, loading, error, browse, retry } = useProjectDirectories(props);
  return <BottomSheet visible title="选择项目" onClose={props.close} dragFromHeaderOnly
    actions={[{ label: '选择此文件夹', tone: 'primary', disabled: loading || !result?.directory,
      onPress: () => { if (result?.directory) props.choose(directoryProject(result.directory)); } }]}>
    <View style={pickerStyles.root}>
      <Text numberOfLines={2} style={pickerStyles.message}>{result?.directory || '此电脑'}</Text>
      <View style={pickerStyles.navigation}>
        <Pressable accessibilityRole="button" disabled={loading} onPress={() => browse('')}>
          <Text style={pickerStyles.link}>此电脑</Text></Pressable>
        {result?.parent != null && <Pressable accessibilityRole="button" disabled={loading}
          onPress={() => browse(result.parent ?? '')}><Text style={pickerStyles.link}>返回上一级</Text></Pressable>}
      </View>
      {loading && <ActivityIndicator accessibilityLabel="正在读取文件夹" style={pickerStyles.message} />}
      {!!error && <View><Text accessibilityRole="alert" style={pickerStyles.message}>{error}</Text>
        <Pressable accessibilityRole="button" onPress={retry}><Text style={pickerStyles.link}>重试</Text></Pressable>
      </View>}
      <FlatList data={result?.entries ?? []} keyExtractor={(entry) => entry.path} style={pickerStyles.list}
        keyboardShouldPersistTaps="handled" nestedScrollEnabled
        renderItem={({ item }) => <Pressable accessibilityRole="button" accessibilityLabel={item.name}
          disabled={loading} onPress={() => browse(item.path)} style={pickerStyles.row}>
          <Feather name="folder" size={21} color="#6f8177" />
          <Text numberOfLines={1} style={pickerStyles.name}>{item.name}</Text>
          <Feather name="chevron-right" size={18} color="#6f8177" />
        </Pressable>}
        ListEmptyComponent={!loading && !error ? <Text style={pickerStyles.message}>此处没有子文件夹</Text> : null}
        ListFooterComponent={result?.truncated
          ? <Text style={pickerStyles.message}>文件夹较多，仅显示部分结果。</Text> : null} />
    </View>
  </BottomSheet>;
}

const pickerStyles = StyleSheet.create({
  root: { width: '100%', maxWidth: 400, alignSelf: 'center' },
  list: { maxHeight: 340, flexGrow: 0 },
  navigation: { flexDirection: 'row', gap: 16 },
  row: { flexDirection: 'row', gap: 12, alignItems: 'center', padding: 12, minHeight: 48 },
  name: { flex: 1, color: '#13231c', fontSize: 15 },
  message: { color: '#6f8177', fontSize: 13, lineHeight: 20, padding: 12 },
  link: { color: '#14806f', fontSize: 13, padding: 12 },
});
