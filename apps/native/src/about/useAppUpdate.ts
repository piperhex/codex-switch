import { useCallback, useEffect, useRef, useState } from 'react';
import { Toast } from '../components/AppToast';
import { checkForAppUpdate, installDownloadedAndroidUpdate,
  type AppUpdateCheck } from '../update/appUpdate';
import { useAndroidUpdateDownloadState } from '../update/useAndroidUpdateDownloadState';
import { beginAppUpdateDownload } from '../update/updateActions';

export { openReleasePage } from '../update/updateActions';

export function useAppUpdate() {
  const [checking, setChecking] = useState(false);
  const [updateCheck, setUpdateCheck] = useState<AppUpdateCheck | null>(null);
  const [error, setError] = useState('');
  const checkingRef = useRef(false);
  const downloadState = useAndroidUpdateDownloadState();
  const checkForUpdate = useCallback(async () => {
    if (checkingRef.current) return;
    checkingRef.current = true;
    setChecking(true);
    setError('');
    try {
      const result = await checkForAppUpdate();
      setUpdateCheck(result);
    } catch {
      setError('暂时无法检查更新，请重试。');
    } finally {
      checkingRef.current = false;
      setChecking(false);
    }
  }, []);
  useEffect(() => { void checkForUpdate(); }, [checkForUpdate]);
  const installDownloaded = () => {
    if (downloadState.status !== 'downloaded') return;
    void installDownloadedAndroidUpdate(downloadState.path).catch(() => Toast.fail('无法开始安装，请稍后重试'));
  };
  return { checking, updateCheck, downloadState, error, checkForUpdate,
    beginDownload: beginAppUpdateDownload, installDownloaded };
}
