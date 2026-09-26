import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Grid2X2, Keyboard, Maximize, Monitor, Mouse, Settings2, X } from 'lucide-react';
import type { DesktopClient } from '../../../../../shared/remote-desktop/protocol';
import { useDesktopSession } from '../../../../../shared/remote-desktop/useDesktopSession';
import { DisplaySettings } from './DisplaySettings';
import { MousePad, useTrackpad } from './MousePad';
import { t } from '../../i18n';
import { usePageVisibility } from './usePageVisibility';
import './desktop.css';

const createPeer = (configuration: RTCConfiguration) => new RTCPeerConnection(configuration);

export function RemoteDesktop({ client, active, close }: {
  client: DesktopClient; active: boolean; close: () => void;
}) {
  const visible = usePageVisibility();
  const session = useDesktopSession({ client, active: active && visible, createPeer });
  const [display, setDisplay] = useState(false);
  const [keyboard, setKeyboard] = useState(false);
  const [mouse, setMouse] = useState(true);
  const [text, setText] = useState('');
  const video = useRef<HTMLVideoElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const trackpad = useTrackpad(session.pointer);
  useEffect(() => {
    const element = video.current;
    if (element) element.srcObject = session.stream ?? null;
    return () => { if (element) element.srcObject = null; };
  }, [session.stream, active]);
  useEffect(() => {
    if (!active) return;
    const previous = document.activeElement as HTMLElement | null;
    root.current?.focus();
    return () => previous?.focus();
  }, [active]);
  const send = () => { if (text) { session.input({ kind: 'text', text }); setText(''); } };
  const fullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    else void root.current?.requestFullscreen?.().catch(() => undefined);
  };
  if (!active) return null;
  return createPortal(<div ref={root} tabIndex={-1} className="rd-root" role="dialog" aria-modal="true"
    aria-label={t('远程桌面')} onContextMenu={event => event.preventDefault()}>
    <div className="rd-stage">
      <video ref={video} autoPlay playsInline muted className="rd-video" />
      <div className="rd-touch" {...trackpad} onWheel={event => {
        session.input({ kind: 'wheel', delta: event.deltaY > 0 ? -120 : 120 });
      }} aria-label={t('远程桌面触控区域')} />
      {session.stats && <span className="rd-stats">
        {session.stats.width} × {session.stats.height} · {session.stats.fps} {t('帧/秒')}
        {session.stats.connection && ` · ${t(session.stats.connection === 'relay' ? '中继' : '直连')}`}</span>}
      {mouse && !display && !keyboard && <MousePad pointer={session.pointer}
        wheel={delta => session.input({ kind: 'wheel', delta })} />}
      {session.status && <div className="rd-status" role="status"><span>{t(session.status)}</span>
        <button onClick={session.retry}>{t('重新连接')}</button></div>}
      {display && <DisplaySettings settings={session.settings} update={session.update} saving={session.saving}
        close={() => setDisplay(false)} />}
      {keyboard && <form className="rd-keyboard" onSubmit={event => { event.preventDefault(); send(); }}>
        <div><input autoFocus value={text} maxLength={1000} aria-label={t('发送到电脑的文字')}
          placeholder={t('输入文字')} onChange={event => setText(event.target.value)} />
          <button type="submit">{t('发送')}</button></div>
        <div>{(['escape', 'tab', 'backspace', 'enter'] as const).map((key, index) =>
          <button key={key} type="button" onClick={() => session.input({ kind: 'key', key })}>
            {t(['Esc', 'Tab', '退格', '回车'][index])}</button>)}
          <button type="button" onClick={() => setKeyboard(false)}>{t('收起')}</button></div>
      </form>}
    </div>
    <nav className="rd-toolbar" aria-label={t('远程桌面操作')}>
      <button aria-pressed={mouse} onClick={() => setMouse(!mouse)}><Mouse /><span>{t('鼠标')}</span></button>
      <button aria-pressed={keyboard} onClick={() => { setKeyboard(!keyboard); setDisplay(false); }}>
        <Keyboard /><span>{t('键盘')}</span></button>
      <button onClick={() => session.input({ kind: 'key', key: 'desktop' })}><Monitor /><span>{t('显示桌面')}</span></button>
      <button onClick={() => session.input({ kind: 'key', key: 'windows' })}><Grid2X2 /><span>{t('所有窗口')}</span></button>
      <button aria-pressed={display} onClick={() => { setDisplay(!display); setKeyboard(false); }}>
        <Settings2 /><span>{t('显示')}</span></button>
      <button onClick={fullscreen}><Maximize /><span>{t('全屏')}</span></button>
      <button onClick={close}><X /><span>{t('关闭')}</span></button>
    </nav>
  </div>, document.body);
}
