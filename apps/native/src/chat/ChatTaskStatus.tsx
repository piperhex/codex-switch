import { StyleSheet, Text, View } from 'react-native';
import { taskStatus } from '../../../../shared/remote-chat/taskStatus';
import { t, useLanguage } from '../i18n';
import type { ChatState } from './types';
import { palette } from './styles';

export function ChatTaskStatus({ state }: { state: ChatState }) {
  useLanguage();
  const status = taskStatus(state);
  if (!status && !state.notificationError) return null;
  return <View accessibilityLiveRegion="polite" style={css.content}>
    {status && <View style={css.row}>
      <Text style={css.label}>{t(status.label)}</Text>
      <Text style={css.detail}>{t(status.detail)}</Text>
    </View>}
    {state.notificationError && <Text accessibilityRole="alert" style={css.detail}>
      {t('部分提醒未能保存，请检查电脑可用空间，并在聊天中核对任务进度。')}</Text>}
  </View>;
}

const css = StyleSheet.create({
  content: { paddingHorizontal: 16, paddingVertical: 6, gap: 4 },
  row: { gap: 2, maxWidth: 400 },
  label: { color: palette.ink, fontSize: 12, fontWeight: '600' },
  detail: { color: palette.muted, fontSize: 12, lineHeight: 18, maxWidth: 400 },
});
