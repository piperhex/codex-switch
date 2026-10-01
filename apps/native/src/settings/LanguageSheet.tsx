import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { BottomSheet } from '../components/BottomSheet';
import { LANGUAGE_OPTIONS, languageLabel, t, useLanguage, type Language } from '../i18n';
import { setLanguage } from '../i18n/preference';
import { settingsColors, styles } from './styles';

export function LanguageSheet({ onClose }: { onClose: () => void }) {
  const language = useLanguage();
  const [error, setError] = useState(false);
  const choose = async (next: Language) => {
    if (await setLanguage(next)) onClose();
    else setError(true);
  };
  return <BottomSheet visible title={t('语言')} onClose={onClose} maxWidth={400}>
    <View style={styles.sheetBody} accessibilityRole="radiogroup">
      {LANGUAGE_OPTIONS.map(option => <Pressable key={option.value} accessibilityRole="radio"
        accessibilityLabel={option.label} accessibilityState={{ checked: language === option.value }}
        style={localStyles.option} onPress={() => void choose(option.value)}>
        <Text style={styles.detailLabel}>{option.label}</Text>
        {language === option.value && <Text style={localStyles.check}>✓</Text>}
      </Pressable>)}
      {error && <Text accessibilityRole="alert" style={styles.error}>
        {t('语言已切换，但未能保存。下次打开应用后请重新选择。')}
      </Text>}
    </View>
  </BottomSheet>;
}

export function LoginLanguagePicker() {
  const language = useLanguage();
  const [open, setOpen] = useState(false);
  return <>
    <Pressable accessibilityRole="button" accessibilityLabel={`${t('语言')} ${languageLabel(language)}`}
      onPress={() => setOpen(true)} style={localStyles.login}>
      <Text style={localStyles.link}>{languageLabel(language)} ﹀</Text>
    </Pressable>
    {open && <LanguageSheet onClose={() => setOpen(false)} />}
  </>;
}

const localStyles = StyleSheet.create({
  option: { minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  check: { color: settingsColors.green, fontSize: 20 },
  login: { alignSelf: 'center', padding: 12, marginBottom: 8 },
  link: { color: settingsColors.blue, fontSize: 15 },
});
