import { english } from './en';
import { russian } from './ru';
import type { Language } from './language';

export type TranslationValues = Record<string, string | number>;
const dictionaries: Record<'en' | 'ru', Readonly<Record<string, string>>> = { en: english, ru: russian };

/** Substitute once so values containing placeholders or replacement tokens remain verbatim. */
export function interpolate(template: string, values: TranslationValues = {}): string {
  return template.replace(/\{(\w+)\}/g, (placeholder, key: string) =>
    Object.prototype.hasOwnProperty.call(values, key) ? String(values[key]) : placeholder);
}

/** Only translate application copy, never messages, paths, code or other user data. */
export function translateText(language: Language, source: string, values: TranslationValues = {}): string {
  const dictionary = language === 'zh' ? undefined : dictionaries[language];
  const template = dictionary && Object.prototype.hasOwnProperty.call(dictionary, source)
    ? dictionary[source] : source;
  return interpolate(template, values);
}
