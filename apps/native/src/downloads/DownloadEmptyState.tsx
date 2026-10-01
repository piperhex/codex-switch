import { t, useLanguage } from '../i18n';
import { Ionicons } from '@expo/vector-icons';
import { Text, View } from 'react-native';
import { colors, styles } from './styles';

export function DownloadEmptyState() {
  useLanguage();
  return <View style={styles.empty}>
    <View style={styles.emptyHalo}>
      <View style={styles.emptyIcon}><Ionicons name="download-outline" size={34} color={colors.green} /></View>
      <View style={styles.emptyBadge}><Ionicons name="add" size={16} color={colors.surface} /></View>
    </View>
    <Text style={styles.emptyTitle}>{t("暂无下载")}</Text>
    <Text style={styles.emptyText}>{t("从上方浏览文件，或在聊天中下载文件。")}{'\n'}{t("下载进度和已保存的文件都会显示在这里。")}</Text>
  </View>;
}
