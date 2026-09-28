import { useRef } from 'react';
import { Dialog, Toast } from 'antd-mobile';
import { apiJson } from '../api';
import type { RemoteDevice } from '../types';

export function useRevokeDesktopService() {
  const busy = useRef(false);
  return async (device: RemoteDevice) => {
    if (busy.current) return;
    busy.current = true;
    try {
      const confirmed = await Dialog.confirm({ title: '撤销无人值守授权？',
        content: '撤销后，电脑需重新启用无人值守才能在尚未登录时访问。', confirmText: '撤销授权',
        bodyStyle: { maxWidth: 400, width: 'calc(100vw - 32px)' } });
      if (!confirmed) return;
      await apiJson(`/devices/${encodeURIComponent(device.deviceId)}/service-credential`, { method: 'DELETE' });
      Toast.show({ content: '无人值守授权已撤销' });
    } catch { Toast.show({ content: '撤销未完成，请检查网络后重试。' }); }
    finally { busy.current = false; }
  };
}
