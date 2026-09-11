import { useEffect, useRef, useState } from 'react';
import { Pressable, Text } from 'react-native';
import { setStringAsync } from 'expo-clipboard';
import { styles } from './styles';

export function CopyTextButton({ text, label = '复制' }: { text: string; label?: string }) {
  const [status, setStatus] = useState('');
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const copy = async () => {
    try { await setStringAsync(text); setStatus('已复制'); }
    catch { setStatus('复制失败，请重试'); }
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setStatus(''), 2000);
  };
  return <Pressable accessibilityRole="button" accessibilityLabel={label} style={styles.compactButton}
    onPress={() => void copy()}><Text style={[styles.buttonText, { maxWidth: 400 }]}>{status || label}</Text></Pressable>;
}
