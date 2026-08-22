import { useCallback, useEffect, useRef, useState } from 'react';
import * as Clipboard from 'expo-clipboard';
import {
  ActivityIndicator,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';
import ReactNativeBlobUtil from 'react-native-blob-util';
import {
  completeEmbeddedAccountOAuth,
  importPersonalAccounts,
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

type AddMode = 'choice' | 'oauth' | 'import';

function messageOf(error: unknown) {
  const message = error instanceof Error ? error.message : '';
  if (/expired|not found/i.test(message)) return '授权已过期，请重新打开登录窗口';
  if (/state is invalid/i.test(message)) return '安全校验失败，请重新授权';
  if (/cancel/i.test(message)) return '你已取消 ChatGPT 授权';
  if (/reach|connect|network|HTTP 5\d\d/i.test(message)) return '暂时无法连接服务，请检查网络后重试';
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
  return { status: 'failed', message: '授权等待超时，请重新尝试' } as const;
}

function LoadingState({ message }: { message: string }) {
  return <View style={styles.centered}><ActivityIndicator color="#18af8c" size="large" /><Text style={styles.stateText}>{message}</Text></View>;
}

function ErrorState({ message, onRetry, onClose }: { message: string; onRetry: () => void; onClose: () => void }) {
  return <View style={styles.centered}>
    <View style={styles.errorIcon}><Text style={styles.errorIconText}>!</Text></View>
    <Text style={styles.errorTitle}>暂时无法完成授权</Text><Text style={styles.errorText}>{message}</Text>
    <View style={styles.errorActions}>
      <Pressable onPress={onClose} style={styles.secondaryButton}><Text style={styles.secondaryButtonText}>关闭</Text></Pressable>
      <Pressable onPress={onRetry} style={styles.primaryButton}><Text style={styles.primaryButtonText}>重新授权</Text></Pressable>
    </View>
  </View>;
}

function ImportPanel({ busy, initialContent, onBack, onSubmit, onFile, onClipboard }: {
  busy: boolean;
  initialContent: string;
  onBack: () => void;
  onSubmit: (content: string) => void;
  onFile: () => void;
  onClipboard: () => void;
}) {
  const [content, setContent] = useState(initialContent);
  useEffect(() => { setContent(initialContent); }, [initialContent]);
  return <View style={styles.importPanel}>
    <Text style={styles.importTitle}>导入账号 JSON</Text>
    <Text style={styles.importHint}>支持 auth.json、兼容导出文件，也可以直接粘贴内容。</Text>
    <TextInput value={content} onChangeText={setContent} multiline textAlignVertical="top" autoCapitalize="none"
      placeholder="在这里粘贴账号 JSON" placeholderTextColor="#91a198" style={styles.importInput} />
    <View style={styles.importActions}>
      <Pressable disabled={busy} onPress={onFile} style={styles.importAction}><Text style={styles.importActionText}>选择文件</Text></Pressable>
      <Pressable disabled={busy} onPress={onClipboard} style={styles.importAction}><Text style={styles.importActionText}>读取剪贴板</Text></Pressable>
    </View>
    <View style={styles.errorActions}>
      <Pressable onPress={onBack} style={styles.secondaryButton}><Text style={styles.secondaryButtonText}>返回</Text></Pressable>
      <Pressable disabled={busy || !content.trim()} onPress={() => onSubmit(content)} style={[styles.primaryButton, (!content.trim() || busy) && styles.disabled]}>
        {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryButtonText}>开始导入</Text>}
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
  const [mode, setMode] = useState<AddMode>('choice');
  const [initialImport, setInitialImport] = useState('');
  const [oauth, setOauth] = useState<EmbeddedAccountOAuthStart | null>(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [pageLoading, setPageLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const completingRef = useRef(false);

  useEffect(() => {
    if (!visible) {
      completingRef.current = false;
      setMode('choice'); setInitialImport(''); setOauth(null); setError(''); setPageLoading(false); setBusy(false);
    }
  }, [visible]);

  useEffect(() => {
    if (!visible || mode !== 'oauth') return undefined;
    let cancelled = false;
    setOauth(null); setError(''); completingRef.current = false;
    void startEmbeddedAccountOAuth(session).then((result) => {
      if (!cancelled) { setOauth(result); setPageLoading(true); }
    }).catch((cause) => { if (!cancelled) setError(messageOf(cause)); });
    return () => { cancelled = true; };
  }, [attempt, mode, session, visible]);

  const close = useCallback(() => {
    completingRef.current = false; setMode('choice'); setOauth(null); setError(''); setBusy(false); onClose();
  }, [onClose]);

  const finishAuthorization = useCallback(async (activeOauth: EmbeddedAccountOAuthStart, callback: EmbeddedAccountOAuthCallback) => {
    try {
      let result: AccountOAuthPoll = await completeEmbeddedAccountOAuth(session, activeOauth.sessionId, callback);
      if (result.status === 'pending') result = await waitForCompletion(session, activeOauth.sessionId);
      if (result.status !== 'complete') throw new Error(result.message);
      Toast.success('账户已添加'); close(); await onAdded();
    } catch (cause) { completingRef.current = false; setBusy(false); setError(messageOf(cause)); }
  }, [close, onAdded, session]);

  const handleNavigation = useCallback((url: string) => {
    if (!oauth || completingRef.current) return true;
    const callback = parseEmbeddedOAuthCallback(url, oauth.callbackUrl);
    if (!callback) return true;
    completingRef.current = true; setBusy(true); void finishAuthorization(oauth, callback); return false;
  }, [finishAuthorization, oauth]);

  const submitImport = async (content: string) => {
    setBusy(true);
    try {
      const result = await importPersonalAccounts(session, content);
      Toast.success(result.skippedCount ? `已导入 ${result.importedCount} 个，跳过 ${result.skippedCount} 个` : `已导入 ${result.importedCount} 个账户`);
      close(); await onAdded();
    } catch (cause) { Toast.fail(messageOf(cause)); }
    finally { setBusy(false); }
  };

  const readClipboard = async () => {
    try { const content = await Clipboard.getStringAsync(); if (!content.trim()) throw new Error('剪贴板中没有 JSON 内容'); setInitialImport(content); setMode('import'); }
    catch (cause) { Toast.fail(messageOf(cause)); }
  };

  const chooseFile = async () => {
    if (Platform.OS !== 'android') { Toast.fail('iPhone 端请复制 JSON 后使用“读取剪贴板”'); return; }
    try {
      const uri = await ReactNativeBlobUtil.android.getContentIntent('application/json');
      if (!uri) return;
      const content = await ReactNativeBlobUtil.fs.readFile(uri, 'utf8');
      await submitImport(content);
    } catch (cause) { Toast.fail(messageOf(cause)); }
  };

  return <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={close}>
    <SafeAreaView style={styles.root}>
      <View style={styles.header}><View style={styles.heading}><Text style={styles.title}>添加账户</Text><Text style={styles.subtitle}>{mode === 'import' ? '导入已有账号凭据' : '选择一种安全的添加方式'}</Text></View><Pressable disabled={busy} onPress={close} style={styles.closeButton}><Text style={styles.closeText}>×</Text></Pressable></View>
      <View style={styles.browser}>
        {mode === 'choice' ? <View style={styles.choicePanel}>
          <Pressable onPress={() => setMode('oauth')} style={styles.choice}><Text style={styles.choiceIcon}>◎</Text><View><Text style={styles.choiceTitle}>ChatGPT 授权</Text><Text style={styles.choiceHint}>在安全窗口中完成登录</Text></View></Pressable>
          <Pressable onPress={() => void chooseFile()} style={styles.choice}><Text style={styles.choiceIcon}>⌘</Text><View><Text style={styles.choiceTitle}>导入 JSON 文件</Text><Text style={styles.choiceHint}>支持 auth.json 和兼容导出格式</Text></View></Pressable>
          <Pressable onPress={() => void readClipboard()} style={styles.choice}><Text style={styles.choiceIcon}>▣</Text><View><Text style={styles.choiceTitle}>从剪贴板导入</Text><Text style={styles.choiceHint}>直接粘贴账号 JSON 内容</Text></View></Pressable>
        </View> : mode === 'import' ? <ImportPanel busy={busy} initialContent={initialImport} onBack={() => setMode('choice')} onSubmit={(content) => void submitImport(content)} onFile={() => void chooseFile()} onClipboard={() => void readClipboard()} />
          : error ? <ErrorState message={error} onRetry={() => setAttempt((value) => value + 1)} onClose={close} /> : oauth ? <><WebView source={{ uri: oauth.authorizationUrl }} incognito cacheEnabled={false} sharedCookiesEnabled={false} thirdPartyCookiesEnabled saveFormDataDisabled setSupportMultipleWindows={false} javaScriptEnabled domStorageEnabled onLoadStart={() => setPageLoading(true)} onLoadEnd={() => setPageLoading(false)} onShouldStartLoadWithRequest={(request) => handleNavigation(request.url)} onNavigationStateChange={(navigation) => { handleNavigation(navigation.url); }} onError={() => { if (!completingRef.current) setError('登录页面加载失败，请检查网络后重试'); }} style={styles.webView} />{pageLoading && !busy ? <View style={styles.loadingOverlay}><ActivityIndicator color="#18af8c" /></View> : null}{busy ? <View style={styles.completingOverlay}><LoadingState message="正在安全保存账户…" /></View> : null}</> : <LoadingState message="正在打开 ChatGPT 安全登录…" />}
      </View>
    </SafeAreaView>
  </Modal>;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#f7faf8' },
  header: { flexDirection: 'row', alignItems: 'flex-start', gap: 14, paddingHorizontal: 18, paddingTop: 12, paddingBottom: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#dce6e0', backgroundColor: '#fff' },
  heading: { flex: 1, minWidth: 0, maxWidth: 400 },
  title: { color: '#10251d', fontSize: 19, lineHeight: 25, fontWeight: '800' },
  subtitle: { color: '#708078', fontSize: 12, lineHeight: 18, marginTop: 4 },
  closeButton: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#eef3f0', alignItems: 'center', justifyContent: 'center' },
  closeText: { color: '#52645b', fontSize: 25, lineHeight: 28, marginTop: -2 },
  browser: { flex: 1, backgroundColor: '#fff' },
  webView: { flex: 1, backgroundColor: '#fff' },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 },
  stateText: { color: '#62756b', fontSize: 13, marginTop: 14, textAlign: 'center' },
  choicePanel: { padding: 20, gap: 12 },
  choice: { flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 72, padding: 15, borderWidth: 1, borderColor: '#dce8df', borderRadius: 15, backgroundColor: '#fff' },
  choiceIcon: { width: 40, height: 40, borderRadius: 12, color: '#0b8065', backgroundColor: '#e6f8f1', textAlign: 'center', textAlignVertical: 'center', fontSize: 25, fontWeight: '800' },
  choiceTitle: { color: '#173128', fontSize: 15, fontWeight: '800' },
  choiceHint: { color: '#708078', fontSize: 11, marginTop: 4 },
  importPanel: { padding: 20 },
  importTitle: { color: '#13231c', fontSize: 18, fontWeight: '800' },
  importHint: { color: '#708078', fontSize: 12, lineHeight: 18, marginTop: 6, marginBottom: 12 },
  importInput: { minHeight: 220, borderWidth: 1, borderColor: '#cbdcd0', borderRadius: 12, padding: 12, color: '#13231c', fontSize: 12, backgroundColor: '#fbfdfb' },
  importActions: { flexDirection: 'row', gap: 9, marginTop: 10 },
  importAction: { flex: 1, minHeight: 42, borderRadius: 10, backgroundColor: '#e8f8f1', alignItems: 'center', justifyContent: 'center' },
  importActionText: { color: '#0b8065', fontSize: 12, fontWeight: '800' },
  errorIcon: { width: 48, height: 48, borderRadius: 16, backgroundColor: '#fff0ef', alignItems: 'center', justifyContent: 'center' },
  errorIconText: { color: '#bd3c35', fontSize: 25, fontWeight: '900' },
  errorTitle: { color: '#8d302b', fontSize: 17, fontWeight: '800', marginTop: 16 },
  errorText: { color: '#6f8177', fontSize: 13, lineHeight: 20, marginTop: 7, textAlign: 'center', maxWidth: 400 },
  errorActions: { flexDirection: 'row', gap: 10, marginTop: 22, width: '100%', maxWidth: 360 },
  secondaryButton: { flex: 1, minHeight: 46, borderRadius: 14, backgroundColor: '#edf2ef', alignItems: 'center', justifyContent: 'center' },
  primaryButton: { flex: 1, minHeight: 46, borderRadius: 14, backgroundColor: '#0b8065', alignItems: 'center', justifyContent: 'center' },
  secondaryButtonText: { color: '#173128', fontSize: 14, fontWeight: '800' },
  primaryButtonText: { color: '#fff', fontSize: 14, fontWeight: '800' },
  loadingOverlay: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,.84)' },
  completingOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(255,255,255,.96)' },
  disabled: { opacity: 0.5 },
});
