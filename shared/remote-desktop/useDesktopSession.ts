import { useEffect, useMemo, useRef, useState } from 'react';
import { DesktopReceiver } from './receiver';
import { DesktopPointer } from './input';
import { DEFAULT_SETTINGS, validateSettings, type DesktopClient, type DesktopSettings, type DesktopStats }
  from './protocol';

interface Options {
  client: DesktopClient;
  active: boolean;
  createPeer: (configuration: RTCConfiguration) => RTCPeerConnection;
}
export function useDesktopSession({ client, active, createPeer }: Options) {
  const receiver = useRef<DesktopReceiver>();
  const settingsRef = useRef(DEFAULT_SETTINGS);
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [stream, setStream] = useState<MediaStream>();
  const [status, setStatus] = useState('正在连接桌面…');
  const [stats, setStats] = useState<DesktopStats>();
  const [attempt, setAttempt] = useState(0);
  const [saving, setSaving] = useState(false);
  const pointer = useMemo(() => new DesktopPointer(input => receiver.current?.input(input)), []);

  useEffect(() => {
    setStream(undefined); setStats(undefined);
    if (!active) return;
    const session = new DesktopReceiver({ client, createPeer, stream: setStream, status: setStatus, stats: setStats });
    receiver.current = session;
    void session.start(settingsRef.current);
    return () => { receiver.current = undefined; pointer.dispose(); session.stop(); };
  }, [client, active, createPeer, pointer, attempt]);

  const update = async (next: DesktopSettings) => {
    if (saving) return;
    try {
      validateSettings(next); setSaving(true);
      await receiver.current?.settings(next);
      settingsRef.current = next; setSettings(next);
    } catch (error) { setStatus(error instanceof Error ? error.message : '显示设置未能保存，请重试。'); }
    finally { setSaving(false); }
  };
  return { stream, status, stats, settings, update, saving, pointer,
    input: (input: Parameters<DesktopReceiver['input']>[0]) => receiver.current?.input(input),
    retry: () => setAttempt(value => value + 1) };
}
