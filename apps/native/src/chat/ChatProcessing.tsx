import { ActivityIndicator, Text, View } from 'react-native';
import type { Turn } from './types';
import { styles } from './styles';
import { useProcessingSeconds } from '../../../../shared/remote-chat/client/useProcessingSeconds';

export function ChatProcessing({ turn, active }: { turn: Turn; active: boolean }) {
  const seconds = useProcessingSeconds(turn, active);
  return <View style={styles.historyStatus}>
    <ActivityIndicator size="small" />
    <Text style={styles.status}>正在处理 · {seconds}秒</Text>
  </View>;
}
