import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';
import {
  completeEmbeddedAccountOAuth,
  pollEmbeddedAccountOAuth,
  startEmbeddedAccountOAuth,
} from '../api/client';
import type {
  AccountOAuthPoll,
  AuthSession,
  EmbeddedAccountOAuthCallback,
  EmbeddedAccountOAuthStart,
} from '../types';
import { parseEmbeddedOAuthCallback } from '../utils/embeddedOAuth';
import { Toast } from './AppToast';

const COMPLETION_POLL_ATTEMPTS = 10;
const COMPLETION_POLL_DELAY_MS = 600;

function messageOf(error: unknown) {
  const message = error instanceof Error ? error.message : '';
  if (/expired|not found/i.test(message)) return '授权已过期，请重新打开登录窗口';
  if (/state is invalid/i.test(message)) return '安全校验失败，请重新授权';
  if (/cancel/i.test(message)) return '你已取消 ChatGPT 授权';
  if (/reach|connect|network|HTTP 5\d\d/i.test(message)) {
    return '暂时无法连接 ChatGPT，请检查网络后重试';
  }
  if (/OAuth|authorization/i.test(message)) return 'ChatGPT 授权失败，请重新尝试';
  return message || '暂时无法添加账户，请稍后重试';
}

function delay(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitForCompletion(session: AuthSession, sessionId: string) {
  for (let attempt = 0; attempt < COMPLETION_POLL_ATTEMPTS; attempt += 1) {
    await delay(COMPLETION_POLL_DELAY_MS);
    const result = await pollEmbeddedAccountOAuth(session, sessionId);
    if (result.status !== 'pending') return result;
  }
  return { status: 'failed', message: 'OAuth session completion timed out' } as const;
}

function LoadingState({ message }: { message: string }) {
  return <View style={styles.centered}>
    <ActivityIndicator color="#18af8c" size="large" />
    <Text style={styles.stateText}>{message}</Text>
  </View>;
}

function ErrorState({ message, onRetry, onClose }: {
  message: string;
  onRetry: () => void;
  onClose: () => void;
}) {
  return <View style={styles.centered}>
    <View style={styles.errorIcon}><Text style={styles.errorIconText}>!</Text></View>
    <Text style={styles.errorTitle}>暂时无法完成授权</Text>
    <Text style={styles.errorText}>{message}</Text>
    <View style={styles.errorActions}>
      <Pressable accessibilityRole="button" onPress={onClose}
        style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]}>
        <Text style={styles.secondaryButtonText}>关闭</Text>
      </Pressable>
      <Pressable accessibilityRole="button" onPress={onRetry}
        style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]}>
        <Text style={styles.primaryButtonText}>重新授权</Text>
      </Pressable>
    </View>
  </View>;
}

export function AddAccountSheet({ session, visible, onAdded, onClose }: {
  session: AuthSession;
  visible: boolean;
  onAdded: () => Promise<void>;
  onClose: () => void;
}) {
  const [oauth, setOauth] = useState<EmbeddedAccountOAuthStart | null>(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [pageLoading, setPageLoading] = useState(false);
  const [completing, setCompleting] = useState(false);
  const completingRef = useRef(false);

  useEffect(() => {
    if (!visible) {
      completingRef.current = false;
      setOauth(null);
      setError('');
      setPageLoading(false);
      setCompleting(false);
      return undefined;
    }
    let cancelled = false;
    completingRef.current = false;
    setOauth(null);
    setError('');
    setCompleting(false);
    void startEmbeddedAccountOAuth(session).then((result) => {
      if (!cancelled) {
        setOauth(result);
        setPageLoading(true);
      }
    }).catch((cause) => {
      if (!cancelled) setError(messageOf(cause));
    });
    return () => { cancelled = true; };
  }, [attempt, session, visible]);

  const close = useCallback(() => {
    completingRef.current = false;
    setOauth(null);
    setError('');
    setPageLoading(false);
    setCompleting(false);
    onClose();
  }, [onClose]);

  const finishAuthorization = useCallback(async (
    activeOauth: EmbeddedAccountOAuthStart,
    callback: EmbeddedAccountOAuthCallback,
  ) => {
    try {
      let result: AccountOAuthPoll = await completeEmbeddedAccountOAuth(
        session,
        activeOauth.sessionId,
        callback,
      );
      if (result.status === 'pending') {
        result = await waitForCompletion(session, activeOauth.sessionId);
      }
      if (result.status !== 'complete') throw new Error(result.message);
      Toast.success('账户已添加或更新');
      try {
        await onAdded();
      } catch {
        Toast.fail('账户已保存，请稍后刷新列表');
      }
      close();
    } catch (cause) {
      setError(messageOf(cause));
      setCompleting(false);
    }
  }, [close, onAdded, session]);

  const handleNavigation = useCallback((url: string) => {
    if (!oauth) return true;
    const callback = parseEmbeddedOAuthCallback(url, oauth.callbackUrl);
    if (!callback) return true;
    if (!completingRef.current) {
      completingRef.current = true;
      setPageLoading(false);
      setCompleting(true);
      void finishAuthorization(oauth, callback);
    }
    return false;
  }, [finishAuthorization, oauth]);

  const retry = () => setAttempt((value) => value + 1);
  if (!visible) return null;

  return <Modal visible={visible} animationType="slide" statusBarTranslucent
    onRequestClose={completing ? undefined : close}>
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <View style={styles.heading}>
          <View style={styles.titleRow}>
            <Text style={styles.title}>添加或更新账户</Text>
            <View style={styles.privateBadge}><Text style={styles.privateBadgeText}>无痕授权</Text></View>
          </View>
          <Text style={styles.subtitle} numberOfLines={2}>
            在独立安全窗口中登录 ChatGPT，关闭后不保留网页登录状态
          </Text>
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel="关闭授权窗口"
          disabled={completing} onPress={close}
          style={({ pressed }) => [styles.closeButton, pressed && styles.pressed, completing && styles.disabled]}>
          <Text style={styles.closeText}>×</Text>
        </Pressable>
      </View>
      <View style={styles.browser}>
        {error
          ? <ErrorState message={error} onRetry={retry} onClose={close} />
          : oauth ? <>
            <WebView
              source={{ uri: oauth.authorizationUrl }}
              incognito
              cacheEnabled={false}
              sharedCookiesEnabled={false}
              thirdPartyCookiesEnabled
              saveFormDataDisabled
              setSupportMultipleWindows={false}
              allowsBackForwardNavigationGestures
              javaScriptEnabled
              domStorageEnabled
              onLoadStart={() => setPageLoading(true)}
              onLoadEnd={() => setPageLoading(false)}
              onShouldStartLoadWithRequest={(request) => handleNavigation(request.url)}
              onNavigationStateChange={(navigation) => { handleNavigation(navigation.url); }}
              onError={() => {
                if (!completingRef.current) setError('登录页面加载失败，请检查网络后重试');
              }}
              style={styles.webView}
            />
            {pageLoading && !completing ? <View style={styles.loadingOverlay}>
              <ActivityIndicator color="#18af8c" />
            </View> : null}
            {completing ? <View style={styles.completingOverlay}>
              <LoadingState message="正在安全保存账户…" />
            </View> : null}
          </> : <LoadingState message="正在打开 ChatGPT 安全登录…" />}
      </View>
    </SafeAreaView>
  </Modal>;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#f7faf8' },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 14,
    paddingHorizontal: 18,
    paddingTop: 12,
    paddingBottom: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#dce6e0',
    backgroundColor: '#ffffff',
  },
  heading: { flex: 1, minWidth: 0, maxWidth: 400 },
  titleRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8 },
  title: { color: '#10251d', fontSize: 19, lineHeight: 25, fontWeight: '800' },
  privateBadge: {
    borderRadius: 999,
    backgroundColor: '#e8f7f1',
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  privateBadgeText: { color: '#0b8065', fontSize: 10, fontWeight: '800' },
  subtitle: { color: '#708078', fontSize: 12, lineHeight: 18, marginTop: 4 },
  closeButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#eef3f0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeText: { color: '#52645b', fontSize: 25, lineHeight: 28, marginTop: -2 },
  browser: { flex: 1, backgroundColor: '#ffffff' },
  webView: { flex: 1, backgroundColor: '#ffffff' },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 },
  stateText: { color: '#62756b', fontSize: 13, marginTop: 14, textAlign: 'center' },
  errorIcon: {
    width: 48,
    height: 48,
    borderRadius: 16,
    backgroundColor: '#fff0ef',
    alignItems: 'center',
    justifyContent: 'center',
  },
  errorIconText: { color: '#bd3c35', fontSize: 25, fontWeight: '900' },
  errorTitle: { color: '#8d302b', fontSize: 17, fontWeight: '800', marginTop: 16 },
  errorText: {
    color: '#6f8177',
    fontSize: 13,
    lineHeight: 20,
    marginTop: 7,
    textAlign: 'center',
    maxWidth: 400,
  },
  errorActions: { flexDirection: 'row', gap: 10, marginTop: 22, width: '100%', maxWidth: 360 },
  secondaryButton: {
    flex: 1,
    minHeight: 46,
    borderRadius: 14,
    backgroundColor: '#edf2ef',
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryButton: {
    flex: 1,
    minHeight: 46,
    borderRadius: 14,
    backgroundColor: '#0b8065',
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryButtonText: { color: '#173128', fontSize: 14, fontWeight: '800' },
  primaryButtonText: { color: '#ffffff', fontSize: 14, fontWeight: '800' },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.84)',
  },
  completingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(255, 255, 255, 0.96)',
  },
  pressed: { opacity: 0.76 },
  disabled: { opacity: 0.5 },
});
