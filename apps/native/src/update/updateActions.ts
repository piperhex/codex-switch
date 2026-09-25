import { Linking, Platform } from 'react-native';
import { Toast } from '../components/AppToast';
import { startAndroidUpdateDownload, type AppRelease } from './appUpdate';

export function openReleasePage(url: string) {
  void Linking.openURL(url).catch(() => Toast.fail('无法打开页面，请稍后重试'));
}

export function beginAppUpdateDownload(release: AppRelease) {
  if (Platform.OS !== 'android' || !release.androidAsset) {
    openReleasePage(release.releaseUrl);
    return;
  }
  Toast.success('已开始下载，可在通知栏查看进度');
  void startAndroidUpdateDownload(release).catch(() => Toast.fail('下载失败，请稍后重试'));
}
