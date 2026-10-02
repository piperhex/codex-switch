import { Text, View } from 'react-native';
import { t, useLanguage } from '../../i18n';
import type { Turn } from '../types';
import { completedTurnFiles } from '../../../../../shared/chat/turnPresentation';
import { resultSummary } from '../../../../../shared/remote-chat/taskReview';
import { useTaskReviewContext } from '../../../../../shared/remote-chat/TaskReviewContext';
import { styles } from '../styles';
import { reviewStyles as css } from './styles';
import { ReviewButton } from './ReviewButton';

export function TaskResultCard({ turn, open }: { turn: Turn; open: () => void }) {
  useLanguage();
  const context = useTaskReviewContext();
  const files = completedTurnFiles(turn);
  if (!context || !files.length || !['completed', 'failed', 'interrupted'].includes(turn.status)) return null;
  return <View style={css.card}>
    <Text style={styles.title}>{t('任务验收')}</Text>
    <Text style={styles.messageText} numberOfLines={3}>
      {resultSummary(turn) || t('查看本轮改动，验证后再决定是否交付。')}</Text>
    <View style={css.row}><Text style={[styles.subtitle, styles.fill]}>
      {t('{value1} 个改动文件', { value1: new Set(files.map(file => file.path)).size })}</Text>
      <ReviewButton label={t('验收结果')} onPress={open} /></View>
  </View>;
}
