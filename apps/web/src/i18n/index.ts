import { messages } from './messages';
import { getLanguage } from './language';
import { terminalMessages } from './terminal';
import { gitMessages } from './git';
import { remoteDesktopMessages } from './remoteDesktop';
import { russian } from '../../../../shared/i18n/ru';

export { getLanguage, getLocale, setLanguage, useLanguage } from './language';
export type { Language } from './language';
type Values = Record<string, string | number>;
const dictionaries = [remoteDesktopMessages, gitMessages, terminalMessages, messages];
const ru: Readonly<Record<string, string>> = russian;

/** Translate application copy only; conversation content and user data must stay verbatim. */
export function t(source: string, values: Values = {}): string {
  const dictionary = dictionaries.find(entries => Object.hasOwn(entries, source));
  const translated = dictionary?.[source];
  const language = getLanguage();
  const template = language === 'ru' ? ru[source] ?? translated ?? source
    : language === 'en' ? translated ?? source : source;
  return template.replace(/\{(\w+)\}/g, (placeholder, key: string) =>
    Object.prototype.hasOwnProperty.call(values, key) ? String(values[key]) : placeholder);
}
