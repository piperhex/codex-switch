import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { BottomSheet } from '../components/BottomSheet';
import type { Model } from './types';
import type { ComposerSettings } from '../../../../shared/remote-chat/composer';
import { SETTINGS_FIELDS, settingOptions, settingValue,
  type SettingField } from '../../../../shared/remote-chat/settingsMenu';
import { palette, styles } from './styles';

interface Props {
  models: Model[];
  selection: ComposerSettings;
  disabled: boolean;
  updateSettings: (settings: Partial<ComposerSettings>) => Promise<void>;
  onClose: () => void;
}

export function ChatSettings({ models, selection, disabled, updateSettings, onClose }: Props) {
  const [field, setField] = useState<SettingField | null>(null);
  const choose = async (value: string) => {
    if (!field || disabled) return;
    if (value !== selection[field]) await updateSettings({ [field]: value });
    setField((current) => current === field ? null : current);
  };
  return <BottomSheet visible title="聊天设置" onClose={onClose}>
    <View style={[styles.settings, menuStyles.content]}
      accessibilityElementsHidden={field !== null} importantForAccessibility={field ? 'no-hide-descendants' : 'auto'}>
      {SETTINGS_FIELDS.map((entry) => <Pressable key={entry.field} accessibilityRole="button"
        accessibilityLabel={`设置${entry.label}`} onPress={() => setField(entry.field)} style={menuStyles.entry}>
        <Text style={styles.title}>{entry.label}</Text>
        <Text numberOfLines={1} style={menuStyles.value}>{settingValue(entry.field, models, selection)}</Text>
        <Text style={menuStyles.arrow}>›</Text>
      </Pressable>)}
    </View>
    {field && <BottomSheet visible title={SETTINGS_FIELDS.find((entry) => entry.field === field)!.title}
      onBack={() => setField(null)} onClose={() => setField(null)}>
      <ScrollView key={field} contentContainerStyle={[styles.settings, menuStyles.content]}>
        {settingOptions(field, models, selection).map((option) => <Pressable key={option.value}
          accessibilityRole="radio" accessibilityLabel={option.label} disabled={disabled}
          accessibilityState={{ checked: selection[field] === option.value, disabled }}
          style={[styles.choice, selection[field] === option.value && styles.chosen, disabled && styles.disabled]}
          onPress={() => { void choose(option.value); }}>
          <View style={styles.row}>
            <Text style={[styles.buttonText, styles.fill]}>{option.label}</Text>
            {selection[field] === option.value && <Text style={styles.buttonText}>✓</Text>}
          </View>
          {option.description && <Text style={styles.subtitle}>{option.description}</Text>}
        </Pressable>)}
      </ScrollView>
    </BottomSheet>}
  </BottomSheet>;
}

const menuStyles = StyleSheet.create({
  content: { paddingBottom: 18 },
  entry: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 60, padding: 14,
    borderWidth: 1, borderColor: palette.border, borderRadius: 12 },
  value: { flex: 1, textAlign: 'right', color: palette.green, fontSize: 13 },
  arrow: { color: palette.muted, fontSize: 22 },
});
