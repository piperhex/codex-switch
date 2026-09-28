import { useEffect, useMemo, useRef, useState } from 'react';
import { DesktopReceiver } from './receiver';
import { DesktopPointer } from './input';
import { DEFAULT_SETTINGS, validateSettings, type DesktopClient, type DesktopDisplay,
  type DesktopSettings, type DesktopStats }
  from './protocol';

interface Options {
  client: DesktopClient;
  active: boolean;
  createPeer: (configuration: RTCConfiguration) => RTCPeerConnection;
}
export function useDesktopSession({ client, active, createPeer }: Options) {
  const receiver = useRef<DesktopReceiver>();
  const settingsRef = useRef(DEFAULT_SETTINGS);
  const closing = useRef(Promise.resolve());
  const updating = useRef(false);
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [displays, setDisplays] = useState<DesktopDisplay[]>([]);
  const [stream, setStream] = useState<MediaStream>();
  const [status, setStatus] = useState('正在连接桌面…');
  const [stats, setStats] = useState<DesktopStats>();
  const [attempt, setAttempt] = useState(0);
  const [saving, setSaving] = useState(false);
  const [muted, setMuted] = useState(false);
  const mutedRef = useRef(false);
  const [hasAudio, setHasAudio] = useState(false);
  const pointer = useMemo(() => new DesktopPointer(input => receiver.current?.input(input)), []);

  useEffect(() => {
    setStream(undefined); setStats(undefined); setHasAudio(false);
    if (!active) return;
    const session = new DesktopReceiver({ client, createPeer, stream: setStream, status: setStatus,
      stats: setStats, audio: setHasAudio, displays: value => {
        setDisplays(value.displays ?? []);
        settingsRef.current = { ...settingsRef.current, displayId: value.displayId };
        setSettings(settingsRef.current);
      } });
    session.mute(mutedRef.current);
    receiver.current = session;
    void closing.current.then(() => { if (receiver.current === session) return session.start(settingsRef.current); });
    return () => {
      pointer.release(); receiver.current = undefined; pointer.dispose(); closing.current = session.stop();
    };
  }, [client, active, createPeer, pointer, attempt]);

  const update = async (next: DesktopSettings) => {
    if (updating.current) return;
    const current = receiver.current;
    if (!current) return;
    try {
      validateSettings(next); updating.current = true; setSaving(true);
      if (next.displayId !== settingsRef.current.displayId) {
        pointer.release(); setStatus('正在切换显示器…');
        closing.current = current.stop(); await closing.current;
        if (receiver.current !== current) return;
        settingsRef.current = next; setSettings(next); setAttempt(value => value + 1);
        return;
      }
      await current.settings(next);
      if (receiver.current !== current) return;
      settingsRef.current = next; setSettings(next);
    } catch (error) { setStatus(error instanceof Error ? error.message : '显示设置未能保存，请重试。'); }
    finally { updating.current = false; setSaving(false); }
  };
  const mute = (value: boolean) => {
    mutedRef.current = value; setMuted(value); receiver.current?.mute(value);
  };
  return { stream, status, stats, settings, displays, update, saving, pointer, muted, mute, hasAudio,
    input: (input: Parameters<DesktopReceiver['input']>[0]) => receiver.current?.input(input),
    retry: () => setAttempt(value => value + 1) };
}
