import { useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView, type Edge } from 'react-native-safe-area-context';
import { RTCPeerConnection, RTCView, type MediaStream as NativeMediaStream } from 'react-native-webrtc';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import type { DesktopClient } from '../../../../../shared/remote-desktop/protocol';
import { useDesktopSession } from '../../../../../shared/remote-desktop/useDesktopSession';
import { useTerminalOrientation } from '../terminal/useTerminalOrientation';
import { DesktopMouse } from './MousePad';
import { useTrackpad } from './useTrackpad';
import { desktopViewport, MOUSE_PANEL_SIZE, MOUSE_ICON_SIZE } from '../../../../../shared/remote-desktop/geometry';
import { useMousePanel } from '../../../../../shared/remote-desktop/useMousePanel';
import { useMouseViewport } from '../../../../../shared/remote-desktop/useMouseViewport';
import { useDesktopZoom } from '../../../../../shared/remote-desktop/useDesktopZoom';
import { DisplaySettings } from './DisplaySettings';
import { DesktopKeyboard } from './DesktopKeyboard';
import { DesktopStats } from './DesktopStats';
import { useDesktopWindow } from './useDesktopWindow';
import { desktopStyles as s } from './styles';

// Native WebRTC owns decryption and decoding; Android uses SurfaceView and iOS uses Metal rendering.
// No video frames, image strings or media ciphertext cross the React Native JavaScript bridge.
const createPeer = (configuration: RTCConfiguration) =>
  new RTCPeerConnection({ iceServers: configuration.iceServers }) as unknown as globalThis.RTCPeerConnection;

export function RemoteDesktop({ client, active, close }: {
  client: DesktopClient; active: boolean; close: () => void;
}) {
  const session = useDesktopSession({ client, active, createPeer });
  const audioUnavailable = !session.hasAudio || session.stats?.audio === 'unavailable';
  const orientation = useTerminalOrientation(active);
  const window = useDesktopWindow(orientation.landscape);
  const [display, setDisplay] = useState(false);
  const [keyboard, setKeyboard] = useState(false);
  const [direct, setDirect] = useState(false);
  const [statsVisible, setStatsVisible] = useState(true);
  const panelVisible = !direct && !display && !keyboard;
  const panel = useMousePanel(active && panelVisible && !!session.stream);
  const [source, setSource] = useState({ width: 16, height: 9 });
  const [size, setSize] = useState({ width: 400, height: 600 });
  const fitted = desktopViewport(size, source);
  const zoom = useDesktopZoom(fitted, active && !!session.stream);
  const viewport = useMouseViewport(session.pointer, zoom.viewport,
    panelVisible ? (panel.expanded ? MOUSE_PANEL_SIZE : MOUSE_ICON_SIZE) : undefined, zoom.modified);
  const trackpad = useTrackpad({ pointer: session.pointer, viewport, direct, panel, id: 'stage', zoom: zoom.gestures });
  const wheel = (delta: number) => { session.pointer.synchronize(); session.input({ kind: 'wheel', delta }); };
  const switchMode = (next: boolean) => { session.pointer.release(); setDirect(next); if (!next) panel.expand(); };
  const safeEdges: Edge[] = ['left', 'right'];
  if (!orientation.landscape) safeEdges.push('top');
  // Android hides its navigation bar; iOS keeps the home indicator visible in landscape.
  if (!orientation.landscape || Platform.OS === 'ios') safeEdges.push('bottom');
  const tools: { label: string; action?: string; icon: keyof typeof Ionicons.glyphMap | 'mouse';
    run: () => void; selected?: boolean; disabled?: boolean }[] = [
    { label: direct ? '触屏' : '鼠标', action: direct ? '切换为鼠标模式' : '切换为触屏模式',
      icon: direct ? 'hand-left-outline' : 'mouse', run: () => switchMode(!direct), selected: true },
    { label: '键盘', icon: 'keypad-outline', run: () => { setKeyboard(!keyboard); setDisplay(false); }, selected: keyboard },
    { label: session.muted ? '开启声音' : '声音',
      action: audioUnavailable ? '声音暂不可用' : session.muted ? '开启声音' : '静音',
      icon: session.muted || audioUnavailable ? 'volume-mute-outline' : 'volume-high-outline',
      run: () => session.mute(!session.muted), selected: !session.muted && !audioUnavailable, disabled: audioUnavailable },
    { label: '显示桌面', icon: 'desktop-outline', run: () => session.input({ kind: 'key', key: 'desktop' }) },
    { label: '所有窗口', icon: 'grid-outline', run: () => session.input({ kind: 'key', key: 'windows' }) },
    { label: '显示', icon: 'options-outline', run: () => { setDisplay(!display); setKeyboard(false); }, selected: display },
    { label: '旋转', icon: 'phone-landscape-outline', run: orientation.rotate },
    { label: '关闭', icon: 'close', run: close },
  ];
  const buttons = tools.map(tool =>
    <Pressable key={tool.label} accessibilityRole="button" accessibilityLabel={tool.action ?? tool.label}
      disabled={tool.disabled} accessibilityState={{ disabled: tool.disabled, selected: tool.selected }}
      style={[s.tool, orientation.landscape && s.railTool, tool.selected && s.selected]} onPress={tool.run}>
      {tool.icon === 'mouse' ? <MaterialCommunityIcons name="mouse" size={22} color="#e7edf8" />
        : <Ionicons name={tool.icon} size={22} color="#e7edf8" />}<Text style={s.label}>{tool.label}</Text>
    </Pressable>);
  return <Modal visible={active} onRequestClose={close} hardwareAccelerated statusBarTranslucent navigationBarTranslucent
    presentationStyle="fullScreen" supportedOrientations={['portrait', 'landscape-left', 'landscape-right']}>
    <SafeAreaProvider><SafeAreaView style={s.root} edges={safeEdges}>
      <StatusBar style="light" hidden={orientation.landscape} />
      <KeyboardAvoidingView style={[s.workspace, orientation.landscape && s.landscape]} behavior="padding"
        enabled={keyboard || display}>
        <View ref={window.stage} collapsable={false} style={s.stage}
          onLayout={({ nativeEvent }) => { setSize(nativeEvent.layout); window.update(); }}>
          {/* Keep the video surface size stable; changing layout during a pinch can lag behind its position. */}
          {session.stream && <RTCView style={{ position: 'absolute', left: 0, top: 0,
            width: fitted.content.width, height: fitted.content.height, transformOrigin: 'top left',
            transform: [{ translateX: viewport.content.x }, { translateY: viewport.content.y },
              { scale: viewport.content.width / fitted.content.width }] }} objectFit="contain" zOrder={0}
            streamURL={(session.stream as unknown as NativeMediaStream).toURL()}
            onDimensionsChange={({ nativeEvent }) => {
              if (nativeEvent.width > 0 && nativeEvent.height > 0) setSource(nativeEvent);
            }} />}
          <View key={direct ? 'direct' : 'trackpad'} style={s.fill} {...trackpad.panHandlers} accessibilityLabel="远程桌面触控区域" />
          {session.stats && statsVisible && !keyboard
            && <DesktopStats stats={session.stats} close={() => setStatsVisible(false)} />}
          {session.stream && <DesktopMouse pointer={session.pointer} viewport={viewport} panel={panel}
            visible={panelVisible} zoomed={zoom.modified} wheel={wheel} />}
          {!!(session.status || orientation.error) && <View style={s.message}>
            <Text accessibilityRole="alert" style={s.text}>{session.status || orientation.error}</Text>
            <Pressable onPress={session.retry}><Text style={s.text}>重新连接</Text></Pressable></View>}
          {display && <DisplaySettings settings={session.settings} displays={session.displays} update={session.update}
            saving={session.saving || !session.stream}
            stats={{ visible: statsVisible, toggle: () => setStatsVisible(!statsVisible) }}
            close={() => setDisplay(false)} />}
          {keyboard && <DesktopKeyboard input={session.input} compact={orientation.landscape}
            close={() => setKeyboard(false)} />}
        </View>
        {orientation.landscape
          ? <ScrollView style={s.rail} contentContainerStyle={[s.toolbar, s.railContent]}
            keyboardShouldPersistTaps="handled" indicatorStyle="white">{buttons}</ScrollView>
          : <View style={s.toolbar}>{buttons}</View>}
      </KeyboardAvoidingView>
    </SafeAreaView></SafeAreaProvider>
  </Modal>;
}
