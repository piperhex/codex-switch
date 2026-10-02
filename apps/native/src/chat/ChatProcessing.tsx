import { ActivityIndicator, Text, View } from 'react-native';
import { styles } from './styles';
import { useLanguage } from '../i18n';
import { useProcessingStatus, type ChatProcessingProps }
  from '../../../../shared/remote-chat/client/useProcessingStatus';

export function ChatProcessing(props: ChatProcessingProps) {
  useLanguage();
  const { label } = useProcessingStatus(props);
  return <View style={[styles.historyStatus, { paddingHorizontal: 16 }]}>
    <ActivityIndicator size="small" />
    <Text style={[styles.status, { flexShrink: 1, maxWidth: 400 }]}>{label}</Text>
  </View>;
}
