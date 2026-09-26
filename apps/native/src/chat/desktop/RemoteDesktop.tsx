import { useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { RTCPeerConnection, RTCView, type MediaStream as NativeMediaStream } from 'react-native-webrtc';
import { Ionicons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import type { DesktopClient } from '../../../../../shared/remote-desktop/protocol';
import { useDesktopSession } from '../../../../../shared/remote-desktop/useDesktopSession';
import { useTerminalOrientation } from '../terminal/useTerminalOrientation';
import { MousePad, useTrackpad } from './MousePad';
import { DisplaySettings } from './DisplaySettings';
import { DesktopKeyboard } from './DesktopKeyboard';
import { desktopStyles as s } from './styles';

// Native WebRTC owns SRTP decryption, jitter buffering, video decoding and SurfaceView rendering.
// No video frames, image strings or media ciphertext cross the React Native JavaScript bridge.
const createPeer = (configuration: RTCConfiguration) =>
  new RTCPeerConnection({ iceServers: configuration.iceServers }) as unknown as globalThis.RTCPeerConnection;

export function RemoteDesktop({ client, active, close }: {
  client: DesktopClient; active: boolean; close: () => void;
}) {
  const session = useDesktopSession({ client, active, createPeer });
  const orientation = useTerminalOrientation(active);
  const [display, setDisplay] = useState(false);
  const [keyboard, setKeyboard] = useState(false);
  const [mouse, setMouse] = useState(true);
  const [size, setSize] = useState({ width: 400, height: 600 });
  const trackpad = useTrackpad({ pointer: session.pointer, ...size });
  const tools: { label: string; icon: keyof typeof Ionicons.glyphMap; run: () => void; selected?: boolean }[] = [
    { label: '鼠标', icon: 'hand-left-outline', run: () => setMouse(!mouse), selected: mouse },
    { label: '键盘', icon: 'keypad-outline', run: () => { setKeyboard(!keyboard); setDisplay(false); }, selected: keyboard },
    { label: '显示桌面', icon: 'desktop-outline', run: () => session.input({ kind: 'key', key: 'desktop' }) },
    { label: '所有窗口', icon: 'grid-outline', run: () => session.input({ kind: 'key', key: 'windows' }) },
    { label: '显示', icon: 'options-outline', run: () => { setDisplay(!display); setKeyboard(false); }, selected: display },
    { label: '旋转', icon: 'phone-landscape-outline', run: orientation.rotate },
    { label: '关闭', icon: 'close', run: close },
  ];
  return <Modal visible={active} onRequestClose={close} hardwareAccelerated statusBarTranslucent
    supportedOrientations={['portrait', 'landscape-left', 'landscape-right']}>
    <SafeAreaProvider><SafeAreaView style={s.root}>
      <StatusBar style="light" />
      <KeyboardAvoidingView style={[s.workspace, orientation.landscape && s.landscape]}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={s.stage} onLayout={({ nativeEvent }) => setSize(nativeEvent.layout)}>
          {session.stream && <RTCView style={s.fill} objectFit="contain" zOrder={0}
            streamURL={(session.stream as unknown as NativeMediaStream).toURL()} />}
          <View style={s.fill} {...trackpad.panHandlers} accessibilityLabel="远程桌面触控区域" />
          {session.stats && <Text style={s.stats}>
            {session.stats.width} × {session.stats.height} · {session.stats.fps} 帧/秒
            {session.stats.connection && ` · ${session.stats.connection === 'relay' ? '中继' : '直连'}`}</Text>}
          {mouse && !display && !keyboard && <MousePad pointer={session.pointer} {...size}
            wheel={delta => session.input({ kind: 'wheel', delta })} />}
          {!!(session.status || orientation.error) && <View style={s.message}>
            <Text accessibilityRole="alert" style={s.text}>{session.status || orientation.error}</Text>
            <Pressable onPress={session.retry}><Text style={s.text}>重新连接</Text></Pressable></View>}
          {display && <DisplaySettings settings={session.settings} update={session.update} saving={session.saving}
            close={() => setDisplay(false)} />}
          {keyboard && <DesktopKeyboard input={session.input} close={() => setKeyboard(false)} />}
        </View>
        <View style={[s.toolbar, orientation.landscape && s.rail]}>{tools.map(tool =>
          <Pressable key={tool.label} accessibilityRole="button" accessibilityLabel={tool.label}
            style={[s.tool, tool.selected && s.selected]} onPress={tool.run}>
            <Ionicons name={tool.icon} size={22} color="#e7edf8" /><Text style={s.label}>{tool.label}</Text>
          </Pressable>)}</View>
      </KeyboardAvoidingView>
    </SafeAreaView></SafeAreaProvider>
  </Modal>;
}
