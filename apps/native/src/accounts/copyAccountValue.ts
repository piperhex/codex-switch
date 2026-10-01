import { t } from '../i18n';
import * as Clipboard from 'expo-clipboard';
import { Toast } from '../components/AppToast';

export async function copyAccountValue(label: string, value: string) {
  if (!value) return;
  try {
    await Clipboard.setStringAsync(value);
    Toast.success(t("已复制{value1}", { value1: label }));
  } catch {
    Toast.fail(t('复制失败，请重试'));
  }
}
