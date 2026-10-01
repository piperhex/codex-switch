import { useEffect, useRef } from 'react';
import { t, useLanguage } from '../../i18n';
import { View } from 'react-native';
import { WebView } from 'react-native-webview';
import { parseDesktopImeMessage } from '../../../../../shared/remote-desktop/ime';
import type { DesktopInput } from '../../../../../shared/remote-desktop/protocol';
import { desktopImeHtml } from './desktopImeHtml.generated';
import { focusDesktopIme } from './focusDesktopIme';

// WebView composition events distinguish candidate text from committed Chinese/Japanese input.
const source = { html: desktopImeHtml };

export function DesktopIme({ input }: { input: (event: DesktopInput) => void }) {
  useLanguage();
  const webview = useRef<WebView>(null);
  const container = useRef<View>(null);
  const labels = `(() => { const field = document.querySelector('textarea'); if (!field) return;
    field.setAttribute('aria-label', ${JSON.stringify(t('发送到电脑的文字'))});
    field.placeholder = ${JSON.stringify(t('输入文字，即时发送到电脑'))}; })(); true;`;
  useEffect(() => { webview.current?.injectJavaScript(labels); }, [labels]);
  return <View ref={container} collapsable={false} style={{ height: 38 }}>
    <WebView ref={webview} source={source}
      style={{ backgroundColor: '#111113' }}
      originWhitelist={['about:blank']} scrollEnabled={false} bounces={false}
      allowFileAccess={false} allowFileAccessFromFileURLs={false} allowUniversalAccessFromFileURLs={false}
      sharedCookiesEnabled={false} thirdPartyCookiesEnabled={false} setSupportMultipleWindows={false}
      javaScriptCanOpenWindowsAutomatically={false} keyboardDisplayRequiresUserAction={false}
      hideKeyboardAccessoryView onShouldStartLoadWithRequest={({ url }) => url === 'about:blank'}
      onLoadEnd={() => {
        webview.current?.injectJavaScript(labels);
        webview.current?.requestFocus();
        webview.current?.injectJavaScript("document.querySelector('textarea').blur(); "
          + "document.querySelector('textarea').focus(); window.ReactNativeWebView.postMessage('focus'); true;");
      }}
      onMessage={({ nativeEvent }) => {
        if (nativeEvent.data === 'focus') { focusDesktopIme(container.current); return; }
        const event = parseDesktopImeMessage(nativeEvent.data);
        if (event) input(event);
      }} />
  </View>;
}
