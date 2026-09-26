import { useEffect, useSyncExternalStore } from 'react';
import { Image, Pressable, Text, View } from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import type { DesktopPointer } from '../../../../../shared/remote-desktop/input';
import { cursorPosition, mousePanelPosition, MOUSE_PANEL_SIZE, MOUSE_ICON_SIZE, type DesktopViewport }
  from '../../../../../shared/remote-desktop/geometry';
import type { MousePanelActivity } from '../../../../../shared/remote-desktop/useMousePanel';
import { useMouseButtons } from '../../../../../shared/remote-desktop/useMouseButtons';
import { useTrackpad } from './useTrackpad';
import { desktopStyles as s } from './styles';

interface Props {
  pointer: DesktopPointer; viewport: DesktopViewport; panel: MousePanelActivity; wheel: (delta: number) => void;
}
export function DesktopMouse({ visible, ...props }: Props & { visible: boolean }) {
  const position = useSyncExternalStore(props.pointer.subscribe, props.pointer.getSnapshot);
  const cursor = cursorPosition(position, props.viewport);
  const panel = mousePanelPosition(cursor);
  const panelSize = props.panel.expanded ? MOUSE_PANEL_SIZE : MOUSE_ICON_SIZE;
  return <>
    <View pointerEvents="none" accessible={false} style={[s.cursor, { left: cursor.x, top: cursor.y }]}>
      <Image accessible={false} source={require('../../../../../shared/remote-desktop/cursor.png')}
        resizeMode="contain" style={s.cursorImage} />
    </View>
    {visible && <View pointerEvents="box-none" style={[s.mouseLayer, panelSize, { left: panel.x, top: panel.y }]}>
      {props.panel.expanded ? <MousePad {...props} /> : <Pressable accessibilityRole="button"
        accessibilityLabel="展开鼠标面板" onPress={props.panel.expand} style={s.mouseIcon}>
        <MaterialCommunityIcons name="mouse" size={23} color="#fff" /></Pressable>}
    </View>}
  </>;
}
function MousePad({ pointer, viewport, panel, wheel }: Props) {
  const buttons = useMouseButtons(pointer);
  const pad = useTrackpad({ pointer, viewport, panel, id: 'pad', cancel: buttons.cancel });
  const grip = useTrackpad({ pointer, viewport, panel, id: 'grip', click: false, cancel: buttons.cancel });
  useEffect(() => { panel.hold('drag', buttons.dragging); return () => panel.hold('drag', false); },
    [buttons.dragging, panel.hold]);
  return <>
    <View style={s.mouse}>
      <View style={s.mouseTop}>{(['left', 'right'] as const).map(button =>
        <Pressable key={button} accessibilityRole="button" accessibilityLabel={button === 'left' ? '鼠标左键' : '鼠标右键'}
          onPressIn={() => { panel.hold(button, true); buttons.down(button); }}
          onPressOut={() => { buttons.up(button); panel.hold(button, false); }}
          style={({ pressed }) => [s.mouseButton, button === 'right' && s.mouseRight,
            (pressed || (button === 'left' && buttons.dragging)) && s.pressed]}>
          <Text style={s.mouseText}>{button === 'left' ? (buttons.dragging ? '拖拽中' : '左键') : '右键'}</Text>
        </Pressable>)}</View>
      <View {...pad.panHandlers} style={[s.pad, pad.pressed && s.pressed]} accessibilityLabel="滑动移动鼠标，轻点单击">
        <Text style={s.mouseText}>滑动移动</Text></View>
      <View style={s.wheel}>{[120, -120].map(delta =>
        <Pressable key={delta} accessibilityRole="button" accessibilityLabel={delta > 0 ? '向上滚动' : '向下滚动'}
          onPressIn={() => panel.hold('wheel', true)} onPressOut={() => panel.hold('wheel', false)}
          style={({ pressed }) => [s.wheelButton, pressed && s.pressed]}
          onPress={() => { panel.activity(); wheel(delta); }}>
          <Ionicons name={delta > 0 ? 'caret-up' : 'caret-down'} size={16} color="#526684" />
        </Pressable>)}</View>
      <View {...grip.panHandlers} style={[s.grip, grip.pressed && s.pressed]} accessibilityLabel="拖动鼠标面板">
        <Ionicons name="reorder-two" size={22} color="#526684" /></View>
    </View>
    <Pressable accessibilityRole="button" accessibilityLabel="收起鼠标面板" onPress={panel.collapse} style={s.mouseClose}>
      <Ionicons name="close" size={20} color="#fff" /></Pressable>
  </>;
}
