import { t, useLanguage, getLocale } from '../i18n';
import { useMemo, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';
import { editedImageMessage, imageEditorHtml } from '../../../../shared/chat/imageEditorHtml';
import type { ChatPhoto } from './chatPhotos';

interface Props { photo: ChatPhoto; save: (dataUrl: string) => void; close: () => void }

export function ChatPhotoEditor({ photo, save, close }: Props) {
  const language = useLanguage();
  const source = useMemo(() => ({ html: imageEditorHtml(photo.dataUrl, t, getLocale()) }), [photo.dataUrl, language]);
  const [error, setError] = useState('');
  const receive = (raw: string) => {
    try {
      if (raw === '{"type":"cancel"}') { close(); return; }
      const dataUrl = editedImageMessage(raw);
      if (!dataUrl) return;
      save(dataUrl);
      close();
    } catch { setError(t("图片未保存，请减少标注或照片后重试。")); }
  };
  return <Modal visible animationType="slide" onRequestClose={close}
    supportedOrientations={['portrait', 'landscape-left', 'landscape-right']}>
    <SafeAreaProvider><SafeAreaView style={styles.container}>
      <WebView source={source} style={styles.container} originWhitelist={['about:blank']}
        scrollEnabled={false} bounces={false} javaScriptEnabled
        allowFileAccess={false} allowFileAccessFromFileURLs={false} allowUniversalAccessFromFileURLs={false}
        setSupportMultipleWindows={false} javaScriptCanOpenWindowsAutomatically={false}
        onShouldStartLoadWithRequest={({ url }) => url === 'about:blank'}
        onMessage={({ nativeEvent }) => receive(nativeEvent.data)}
        onError={() => setError(t("图片无法编辑，请关闭后重试。"))} />
      {!!error && <View style={styles.notice}>
        <Text accessibilityRole="alert" style={styles.error}>{error}</Text>
        <Pressable accessibilityRole="button" onPress={close} style={styles.close}>
          <Text style={styles.error}>{t("关闭编辑")}</Text>
        </Pressable>
      </View>}
    </SafeAreaView></SafeAreaProvider>
  </Modal>;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f1f3f6' },
  notice: { padding: 12, maxWidth: 400, alignSelf: 'center' },
  error: { color: '#b42318', textAlign: 'center' },
  close: { minHeight: 44, justifyContent: 'center' },
});
