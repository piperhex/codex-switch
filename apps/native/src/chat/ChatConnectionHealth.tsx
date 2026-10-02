import { Pressable, StyleSheet, Text, View } from 'react-native';
import { BottomSheet } from '../components/BottomSheet';
import { t, useLanguage } from '../i18n';
import { connectionHealth } from '../../../../shared/remote-chat/connectionHealth';
import type { ChatState } from './types';
import { palette } from './styles';

export function ChatConnectionHealth({ state, device, reconnect, close }: {
  state: ChatState; device?: { online: boolean }; reconnect: () => void; close: () => void;
}) {
  useLanguage();
  const health = connectionHealth(state, device);
  return <BottomSheet visible title={t('连接体检')} onClose={close} maxWidth={400}>
    <View style={css.content}>
      <Text style={css.title}>{t(health.title)}</Text>
      {health.steps.map(step => <View key={step.label} style={css.step}>
        <Text style={css.label}>{t(step.label)} · {t({ ok: '正常', waiting: '待确认', blocked: '需要处理' }[step.status])}</Text>
        <Text style={css.detail}>{t(step.detail)}</Text>
      </View>)}
      <Text style={css.detail}>{t(health.next)}</Text>
      {health.reconnect && <Pressable accessibilityRole="button" onPress={reconnect} style={css.button}>
        <Text style={css.label}>{t('重新连接')}</Text></Pressable>}
    </View>
  </BottomSheet>;
}

const css = StyleSheet.create({
  content: { padding: 16, gap: 12, width: '100%', maxWidth: 400, alignSelf: 'center' },
  title: { color: palette.ink, fontSize: 17, fontWeight: '600' },
  step: { gap: 4 },
  label: { color: palette.ink, fontSize: 14, fontWeight: '500' },
  detail: { color: palette.muted, fontSize: 13, lineHeight: 20, flexShrink: 1 },
  button: { padding: 12, borderWidth: 1, borderColor: palette.border, borderRadius: 8, alignItems: 'center' },
});
