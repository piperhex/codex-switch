import * as Clipboard from 'expo-clipboard';
import { Pressable, Text, View } from 'react-native';
import { totpStyles as styles } from './styles';
import type { TotpEntry } from './types';

interface TotpCodeCardProps {
  code: string;
  entry: TotpEntry;
  now: number;
  onCopied: () => void;
  onDelete: () => void;
  onEdit: () => void;
}

function displayCode(code: string) {
  const splitAt = code.length / 2;
  return `${code.slice(0, splitAt)} ${code.slice(splitAt)}`;
}

export function TotpCodeCard({ code, entry, now, onCopied, onDelete, onEdit }: TotpCodeCardProps) {
  const elapsed = Math.floor(now / 1000) % entry.period;
  const remaining = entry.period - elapsed;
  const progress = `${(remaining / entry.period) * 100}%` as `${number}%`;
  const copy = async () => {
    await Clipboard.setStringAsync(code);
    onCopied();
  };
  return <View style={styles.codeCard}>
    <View style={styles.codeHeader}>
      <View style={styles.codeIdentity}>
        <Text style={styles.issuer} numberOfLines={1}>{entry.issuer}</Text>
        <Text style={styles.account} numberOfLines={1}>{entry.accountName}</Text>
      </View>
      <View style={styles.codeActions}>
        <Pressable style={styles.smallAction} onPress={onEdit}>
          <Text style={styles.smallActionText}>编辑</Text>
        </Pressable>
        <Pressable style={[styles.smallAction, styles.smallActionDanger]} onPress={onDelete}>
          <Text style={[styles.smallActionText, styles.smallActionDangerText]}>删除</Text>
        </Pressable>
      </View>
    </View>
    <Pressable accessibilityRole="button" accessibilityLabel={`复制 ${entry.issuer} 验证码`}
      style={styles.codeButton} onPress={() => void copy()}>
      <View style={styles.codeRow}>
        <Text style={styles.codeValue}>{displayCode(code)}</Text>
        <Text style={styles.countdown}>{remaining} 秒</Text>
      </View>
      <View style={styles.progressTrack}><View style={[styles.progressFill, { width: progress }]} /></View>
    </Pressable>
  </View>;
}
