import { useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { MAX_FPS, type DesktopDisplay, type DesktopSettings } from '../../../../../shared/remote-desktop/protocol';
import { displayLabel } from '../../../../../shared/remote-desktop/displays';
import { desktopStyles as s } from './styles';

export function DisplaySettings({ settings, displays, update, saving, close, stats }: {
  displays: DesktopDisplay[];
  settings: DesktopSettings; update: (next: DesktopSettings) => Promise<void>; saving: boolean; close: () => void;
  stats: { visible: boolean; toggle: () => void };
}) {
  const [custom, setCustom] = useState(settings.fps === 'auto' ? '30' : String(settings.fps));
  const [error, setError] = useState('');
  const apply = () => {
    const fps = Number(custom);
    if (!Number.isInteger(fps) || fps < 1 || fps > MAX_FPS) { setError(`请输入 1–${MAX_FPS} 的整数。`); return; }
    setError(''); void update({ ...settings, fps });
  };
  return <View style={s.panel}>
    <View style={[s.row, { justifyContent: 'space-between', paddingBottom: 14 }]}><Text style={s.heading}>显示</Text>
      <Pressable onPress={close} accessibilityRole="button" accessibilityLabel="关闭显示设置">
        <Text style={s.text}>完成</Text></Pressable></View>
    <ScrollView contentContainerStyle={s.panelContent} keyboardShouldPersistTaps="handled">
    {displays.length > 0 && <View style={{ gap: 8 }}><Text style={s.text}>显示器</Text>
      {displays.map(item => <Pressable key={item.id} disabled={saving} accessibilityRole="radio"
        accessibilityLabel={displayLabel(item)}
        accessibilityState={{ checked: settings.displayId === item.id, disabled: saving }}
        style={[s.choice, settings.displayId === item.id && s.selected]}
        onPress={() => { void update({ ...settings, displayId: item.id }); }}>
        <Text style={s.text}>{displayLabel(item)}</Text></Pressable>)}
    </View>}
    <Pressable style={s.choice} accessibilityRole="switch" accessibilityLabel="连接状态"
      accessibilityState={{ checked: stats.visible }} onPress={stats.toggle}>
      <Text style={s.text}>{stats.visible ? '隐藏连接状态' : '显示连接状态'}</Text></Pressable>
    <Text style={s.text}>帧率</Text><View style={s.row}>
      {(['auto', 30, 60, 90, 144] as const).map(fps => <Pressable key={fps} disabled={saving}
        accessibilityRole="radio" accessibilityState={{ checked: settings.fps === fps }}
        style={[s.choice, settings.fps === fps && s.selected]} onPress={() => { void update({ ...settings, fps }); }}>
        <Text style={s.text}>{fps === 'auto' ? '自动' : `${fps} 帧`}</Text></Pressable>)}
    </View>
    <View style={s.row}><TextInput disableFullscreenUI style={s.input} value={custom} onChangeText={setCustom}
      keyboardType="number-pad" maxLength={3} accessibilityLabel="自定义帧率" />
      <Pressable style={s.choice} onPress={apply} disabled={saving}><Text style={s.text}>应用帧率</Text></Pressable></View>
    <Text style={s.hint}>支持 1–144 帧。实际帧率取决于网络和电脑性能。</Text>
    {!!error && <Text accessibilityRole="alert" style={s.text}>{error}</Text>}
    <Text style={s.text}>画质</Text><View style={s.row}>
      {([{ value: 'auto', label: '自动' }, { value: 'smooth', label: '流畅' },
        { value: 'clear', label: '高清' }, { value: 'original', label: '超清' }] as const).map(item =>
        <Pressable key={item.value} disabled={saving} accessibilityRole="radio"
          accessibilityState={{ checked: settings.quality === item.value }}
          style={[s.choice, settings.quality === item.value && s.selected]}
          onPress={() => { void update({ ...settings, quality: item.value }); }}>
          <Text style={s.text}>{item.label}</Text></Pressable>)}
    </View><Text style={s.hint}>默认根据网络情况调整画质和帧率，让操作保持流畅。</Text>
    <Text style={s.text}>鼠标操作</Text>
    <Text style={s.hint}>在鼠标面板外，双指张合缩放画面，双指滑动平移画面。</Text>
    <Text style={s.hint}>滑动画面或鼠标下半部移动指针，轻点单击。长按左键开始拖拽，再点左键结束。中央箭头用于滚动，横线把手可移动鼠标面板。</Text>
  </ScrollView></View>;
}
