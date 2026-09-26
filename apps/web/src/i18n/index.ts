import { messages } from './messages';
import { getLanguage } from './language';
import { terminalMessages } from './terminal';
import { gitMessages } from './git';
import { remoteDesktopMessages } from './remoteDesktop';

export { getLanguage, getLocale, setLanguage, useLanguage } from './language';
export type { Language } from './language';
type Values = Record<string, string | number>;

/** Translate application copy only; conversation content and user data must stay verbatim. */
export function t(source: string, values: Values = {}): string {
  const translated = remoteDesktopMessages[source] ?? gitMessages[source] ?? terminalMessages[source]
    ?? (Object.hasOwn(messages, source) ? messages[source] : undefined);
  const template = getLanguage() === 'en' ? translated ?? source : source;
  return template.replace(/\{(\w+)\}/g, (placeholder, key: string) =>
    Object.prototype.hasOwnProperty.call(values, key) ? String(values[key]) : placeholder);
}
