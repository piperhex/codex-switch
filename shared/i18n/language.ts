export type Language = 'zh' | 'en' | 'ru';
export const LANGUAGE_OPTIONS = [
  { value: 'zh', label: '简体中文' },
  { value: 'en', label: 'English' },
  { value: 'ru', label: 'Русский' },
] as const;
export const languageLabel = (language: Language) => LANGUAGE_OPTIONS.find(item => item.value === language)!.label;
export const localeForLanguage = (language: Language) => ({ zh: 'zh-CN', en: 'en-US', ru: 'ru-RU' })[language];
export const isLanguage = (value: unknown): value is Language => value === 'zh' || value === 'en' || value === 'ru';

/** Preserve the existing Chinese default for unrecognised locales. */
export function systemLanguage(locale: string): Language {
  if (/^ru(?:[-_]|$)/i.test(locale)) return 'ru';
  return /^en(?:[-_]|$)/i.test(locale) ? 'en' : 'zh';
}
