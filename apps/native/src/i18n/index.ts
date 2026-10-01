import { useSyncExternalStore } from 'react';
import { getInterfaceLanguage, subscribeInterfaceLanguage } from '../../../../shared/i18n/interfaceLanguage';
import { localeForLanguage } from '../../../../shared/i18n/language';
import { translateText, type TranslationValues } from '../../../../shared/i18n/translate';

export { LANGUAGE_OPTIONS, languageLabel } from '../../../../shared/i18n/language';
export type { Language } from '../../../../shared/i18n/language';
export const getLanguage = getInterfaceLanguage;
export const getLocale = () => localeForLanguage(getLanguage());
export const t = (source: string, values?: TranslationValues) => translateText(getLanguage(), source, values);
export const useLanguage = () => useSyncExternalStore(subscribeInterfaceLanguage, getLanguage, () => 'zh' as const);
