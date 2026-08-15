import { useCallback, useEffect, useState } from 'react';
import * as Clipboard from 'expo-clipboard';
import { ActivityIndicator, Linking, StyleSheet, Text, View } from 'react-native';
import { pollAccountOAuth, startAccountOAuth } from '../api/client';
import type { AccountOAuthStart, AuthSession } from '../types';
import { BottomSheet } from './BottomSheet';
import { Toast } from './AppToast';

function messageOf(error: unknown) {
  const message = error instanceof Error ? error.message : '';
  if (/expired|not found/i.test(message)) return '授权已过期，请重新获取授权码';
  if (/reach|connect|HTTP 5\d\d/i.test(message)) return '无法连接 ChatGPT 授权服务，请稍后重试';
  if (/OAuth|authorization/i.test(message)) return 'ChatGPT 授权失败，请重新尝试';
  return message || '添加账户失败，请稍后重试';
}

export function AddAccountSheet({ session, visible, onAdded, onClose }: {
  session: AuthSession;
  visible: boolean;
  onAdded: () => Promise<void>;
  onClose: () => void;
}) {
  const [oauth, setOauth] = useState<AccountOAuthStart | null>(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!visible) return undefined;
    let cancelled = false;
    setOauth(null);
    setError('');
    void startAccountOAuth(session).then((result) => {
      if (!cancelled) setOauth(result);
    }).catch((cause) => {
      if (!cancelled) setError(messageOf(cause));
    });
    return () => { cancelled = true; };
  }, [attempt, session, visible]);

  useEffect(() => {
    if (!visible || !oauth) return undefined;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      try {
        const result = await pollAccountOAuth(session, oauth.sessionId);
        if (cancelled) return;
        if (result.status === 'complete') {
          Toast.success('账户已添加或更新');
          await onAdded();
          if (!cancelled) onClose();
          return;
        }
        if (result.status === 'failed') {
          setError(result.message || 'ChatGPT 授权失败，请重试');
          return;
        }
        timer = setTimeout(poll, oauth.interval * 1_000);
      } catch (cause) {
        if (!cancelled) setError(messageOf(cause));
      }
    };
    timer = setTimeout(poll, oauth.interval * 1_000);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [oauth, onAdded, onClose, session, visible]);

  const openAuthorization = useCallback(async () => {
    if (!oauth) return;
    try {
      await Clipboard.setStringAsync(oauth.userCode);
      await Linking.openURL(oauth.verificationUrl);
      Toast.success('授权码已复制，请在网页中粘贴');
    } catch {
      Toast.fail('无法打开授权页面，请稍后重试');
    }
  }, [oauth]);

  const copyCode = useCallback(async () => {
    if (!oauth) return;
    try {
      await Clipboard.setStringAsync(oauth.userCode);
      Toast.success('授权码已复制');
    } catch {
      Toast.fail('复制失败，请重试');
    }
  }, [oauth]);

  return <BottomSheet
    visible={visible}
    title="添加或更新账户"
    subtitle="使用 ChatGPT 完成授权"
    onClose={onClose}
    actions={error ? [
      { label: '取消', onPress: onClose },
      { label: '重新获取', tone: 'primary', onPress: () => setAttempt((value) => value + 1) },
    ] : oauth ? [
      { label: '复制授权码', onPress: () => void copyCode() },
      { label: '打开授权页面', tone: 'primary', onPress: () => void openAuthorization() },
    ] : [{ label: '取消', onPress: onClose }]}
  >
    <View style={styles.content}>
      {error ? <>
        <Text style={styles.errorTitle}>暂时无法添加账户</Text>
        <Text style={styles.errorText}>{error}</Text>
      </> : oauth ? <>
        <Text style={styles.step}>1. 复制下方授权码并打开 ChatGPT 授权页面</Text>
        <Text selectable style={styles.code}>{oauth.userCode}</Text>
        <Text style={styles.step}>2. 在网页中输入授权码并确认登录</Text>
        <View style={styles.waitingRow}>
          <ActivityIndicator size="small" color="#18af8c" />
          <Text style={styles.waitingText}>正在等待授权完成…</Text>
        </View>
      </> : <View style={styles.loading}>
        <ActivityIndicator color="#18af8c" />
        <Text style={styles.waitingText}>正在获取授权信息…</Text>
      </View>}
    </View>
  </BottomSheet>;
}

const styles = StyleSheet.create({
  content: { minHeight: 210, paddingTop: 4, paddingBottom: 18 },
  step: { color: '#566d62', fontSize: 13, lineHeight: 20, marginBottom: 10 },
  code: {
    color: '#0b8065',
    fontSize: 27,
    fontWeight: '900',
    letterSpacing: 2,
    textAlign: 'center',
    borderRadius: 14,
    backgroundColor: '#eaf9f4',
    paddingVertical: 18,
    marginBottom: 18,
  },
  waitingRow: { flexDirection: 'row', alignItems: 'center', gap: 9, marginTop: 8 },
  waitingText: { color: '#6f8177', fontSize: 12 },
  loading: { flex: 1, minHeight: 170, alignItems: 'center', justifyContent: 'center', gap: 12 },
  errorTitle: { color: '#bd3c35', fontSize: 16, fontWeight: '800', marginBottom: 8 },
  errorText: { color: '#6f8177', fontSize: 13, lineHeight: 20 },
});
