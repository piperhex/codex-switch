import { guiText } from "../../i18n/guiText";
import { useEffect, useRef, useState } from 'react';
import { canManageCodexConnection, isHostedWebApp } from '../../api/backend';
import { RequestSpeedButton } from '../../../../../shared/remote-chat/RequestSpeedButton';
import type { RequestSpeed } from '../../../../../shared/remote-chat/composer';
import { guiRequestSpeed } from './requestSpeedBridge';

export function GuiSpeedButton({ active }: { active: boolean }) {
  const [speed, setSpeed] = useState<RequestSpeed>();
  const [available, setAvailable] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const changing = useRef(false);
  const mounted = useRef(false);
  useEffect(() => {
    if (!active) return;
    mounted.current = true;
    setBusy(changing.current);
    const update = (value: RequestSpeed) => {
      setSpeed(value); setAvailable(guiRequestSpeed.settings?.fastModeAvailable ?? false); setError('');
    };
    const stop = guiRequestSpeed.subscribe(update);
    void guiRequestSpeed.read().then((value) => { if (mounted.current) update(value); }).catch(() => {
      if (mounted.current) setError(guiText("暂时无法读取速度设置，请稍后重试。"));
    });
    return () => { mounted.current = false; stop(); };
  }, [active]);
  const change = async (next: RequestSpeed) => {
    if (changing.current) return;
    changing.current = true; setBusy(true);
    try { await guiRequestSpeed.set(next); }
    catch { if (mounted.current) setError(guiText("速度模式未能切换，请稍后重试。")); }
    finally { changing.current = false; if (mounted.current) setBusy(false); }
  };
  return <RequestSpeedButton speed={speed} busy={busy} error={error} available={available} translate={guiText}
    disabled={isHostedWebApp && !canManageCodexConnection}
    onChange={(next) => { void change(next); }} />;
}
