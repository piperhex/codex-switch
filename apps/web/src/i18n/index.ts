import { getLanguage } from './language';
import { translateText, type TranslationValues } from '../../../../shared/i18n/translate';

export { getLanguage, getLocale, setLanguage, useLanguage } from './language';
export { LANGUAGE_OPTIONS, languageLabel } from '../../../../shared/i18n/language';
export type { Language } from './language';
export const t = (source: string, values?: TranslationValues): string => translateText(getLanguage(), source, values);
