import { getInterfaceLanguage, setInterfaceLanguage } from '../../../../shared/i18n/interfaceLanguage';
import { localeForLanguage, type Language } from '../../../../shared/i18n/language';
import { translateText, type TranslationValues } from '../../../../shared/i18n/translate';

export const setGuiLanguage = setInterfaceLanguage;
export const guiLanguage = getInterfaceLanguage;
export const guiLocale = () => localeForLanguage(guiLanguage());

/** Only call for application copy; never translate conversation content or user data. */
export function guiText(source: string, values: TranslationValues = {}, language: Language = guiLanguage()): string {
  return translateText(language, source, values);
}
