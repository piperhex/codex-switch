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
  pointer: DesktopPointer; viewport: DesktopViewport; panel: MousePanelActivity; scroll: () => void;
}
export function DesktopMouse({ visible, zoomed = false, ...props }: Props & { visible: boolean; zoomed?: boolean }) {
  const position = useSyncExternalStore(props.pointer.subscribe, props.pointer.getSnapshot);
  const cursor = cursorPosition(position, props.viewport);
  const panelSize = props.panel.expanded ? MOUSE_PANEL_SIZE : MOUSE_ICON_SIZE;
  const panel = mousePanelPosition(cursor, zoomed ? props.viewport.stage : undefined, panelSize);
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
function MousePad({ pointer, viewport, panel, scroll }: Props) {
  const buttons = useMouseButtons(pointer);
  const pad = useTrackpad({ pointer, viewport, panel, id: 'pad', cancel: buttons.cancel });
  const grip = useTrackpad({ pointer, viewport, panel, id: 'grip', click: false, cancel: buttons.cancel });
  useEffect(() => { panel.hold('drag', buttons.dragging); return () => panel.hold('drag', false); },
    [buttons.dragging, panel.hold]);
  return <View style={s.mouse}>
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
    <Pressable accessibilityRole="button" accessibilityLabel="展开滚动滑块" onPress={scroll}
      style={({ pressed }) => [s.wheel, pressed && s.pressed]}>
      <Ionicons name="chevron-up" size={18} color="#526684" />
      <Ionicons name="chevron-down" size={18} color="#526684" /></Pressable>
    <View {...grip.panHandlers} style={[s.grip, grip.pressed && s.pressed]} accessibilityLabel="拖动鼠标面板">
      <Ionicons name="reorder-two" size={22} color="#526684" /></View>
  </View>;
}
