import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { WebView } from 'react-native-webview';
import type { GuiToolsClient } from '../../../../../shared/remote-chat/guiTools';
import { remoteTerminalApi } from '../../../../../shared/remote-chat/terminalApi';
import { createTerminalBridge } from '../../../../../shared/terminal/webviewBridge';
import { terminalDocument } from './terminalDocument';
import { terminalStyles as styles } from './styles';

export function TerminalSession({ client, cwd, visible, deviceName, hide, close }: {
  client: GuiToolsClient['terminal']; cwd: string; visible: boolean; deviceName?: string;
  hide: () => void; close: () => void;
}) {
  const webview = useRef<WebView>(null);
  const [html, setHtml] = useState('');
  const [status, setStatus] = useState('正在打开终端…');
  const [generation, setGeneration] = useState(0);
  const source = useMemo(() => ({ html }), [html]);
  const bridge = useMemo(() => createTerminalBridge({ cwd, api: remoteTerminalApi(client), status: setStatus,
    emit: event => webview.current?.injectJavaScript(`window.remoteTerminal(${JSON.stringify(event)}); true;`),
  }), [client, cwd]);
  useEffect(() => () => bridge.dispose(), [bridge]);
  useEffect(() => {
    if (!visible) bridge.detach();
    else setGeneration(value => value + 1);
  }, [visible, bridge]);
  useEffect(() => {
    let cancelled = false;
    void terminalDocument().then(value => { if (!cancelled) setHtml(value); })
      .catch(() => { if (!cancelled) setStatus('终端未能加载，请关闭后重新打开。'); });
    return () => { cancelled = true; };
  }, []);
  return <Modal visible={visible} transparent animationType="slide" onRequestClose={hide}
    statusBarTranslucent supportedOrientations={['portrait', 'landscape-left', 'landscape-right']}>
    <SafeAreaProvider><SafeAreaView style={styles.overlay} edges={['bottom']}>
      <Pressable accessibilityRole="button" accessibilityLabel="收起终端" style={styles.backdrop} onPress={hide} />
      <View style={styles.drawer} accessibilityViewIsModal>
        <View style={styles.header}>
          <View style={styles.heading}><Text style={styles.title}>远程终端</Text>
            <Text numberOfLines={1} style={styles.subtitle}>{deviceName}{cwd ? ` · ${cwd}` : ''}</Text></View>
          <Pressable accessibilityRole="button" accessibilityLabel="关闭终端" style={styles.button} onPress={close}>
            <Ionicons name="trash-outline" size={21} color="#718078" /></Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="收起终端" style={styles.button} onPress={hide}>
            <Ionicons name="chevron-down" size={24} color="#17211b" /></Pressable>
        </View>
        {html ? <WebView key={generation} ref={webview} source={source} style={styles.screen}
          originWhitelist={['about:blank']} javaScriptEnabled scrollEnabled={false} bounces={false}
          allowFileAccess={false} allowFileAccessFromFileURLs={false} allowUniversalAccessFromFileURLs={false}
          sharedCookiesEnabled={false} thirdPartyCookiesEnabled={false} setSupportMultipleWindows={false}
          javaScriptCanOpenWindowsAutomatically={false} keyboardDisplayRequiresUserAction={false}
          onShouldStartLoadWithRequest={({ url }) => url === 'about:blank'}
          onMessage={({ nativeEvent }) => { if (visible) bridge.receive(nativeEvent.data); }}
          onError={() => setStatus('终端显示遇到问题，请收起后重新打开。')} />
          : <ActivityIndicator style={styles.loading} color="#14806f" />}
        {!!status && <Text accessibilityRole="alert" style={styles.status}>{status}</Text>}
      </View>
    </SafeAreaView></SafeAreaProvider>
  </Modal>;
}
