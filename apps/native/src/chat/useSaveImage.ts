import { t } from '../i18n';
import { useEffect, useRef, useState } from 'react';
import { DownloadPolicyError } from '../../../../shared/remote-chat/policy';
import { ImageSavePermissionError, saveImage } from './saveImage';

export function useSaveImage(url: string | undefined) {
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const busy = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(() => setMessage(''), 3000);
    return () => clearTimeout(timer);
  }, [message]);
  const save = async () => {
    if (!url || busy.current) return;
    busy.current = true;
    setSaving(true);
    setMessage('');
    try {
      await saveImage(url);
      if (mounted.current) setMessage(t("已保存到相册"));
    } catch (error) {
      if (mounted.current) setMessage(error instanceof ImageSavePermissionError || error instanceof DownloadPolicyError
        ? error.message : t("保存失败，请重试"));
    } finally {
      busy.current = false;
      if (mounted.current) setSaving(false);
    }
  };
  return { saving, message, save };
}
