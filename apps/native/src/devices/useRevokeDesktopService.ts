import { t } from '../i18n';
import { useRef } from 'react';
import { Alert } from 'react-native';
import { Toast } from '../components/AppToast';
import { revokeDesktopService } from '../api/client';
import type { AuthSession, RemoteDevice } from '../types';

export function useRevokeDesktopService(session: AuthSession) {
  const busy = useRef(false);
  return (device: RemoteDevice) => {
    if (busy.current) return;
    Alert.alert(t("撤销无人值守授权？"), t("撤销后，电脑需重新启用无人值守才能在尚未登录时访问。"), [
      { text: t("取消"), style: 'cancel' },
      { text: t("撤销授权"), style: 'destructive', onPress: () => {
        if (busy.current) return;
        busy.current = true;
        void revokeDesktopService(session, device.deviceId)
          .then(() => Toast.success(t("无人值守授权已撤销")))
          .catch(() => Toast.fail(t("撤销未完成，请检查网络后重试。")))
          .finally(() => { busy.current = false; });
      } },
    ]);
  };
}
