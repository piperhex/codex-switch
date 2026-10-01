import { russian } from "../../../../shared/i18n/ru";
import { DEFAULT_LANGUAGE, getLocale, isLanguage, LANGUAGE_STORAGE_KEY, type Language } from "../i18n";

const messages: Readonly<Record<string, string>> = russian;
let selectedLanguage: Language | undefined;

/** The desktop and web roots set their own language before rendering shared UI. */
export function setGuiLanguage(language: Language) {
  selectedLanguage = language;
}

export function guiLanguage(): Language {
  if (selectedLanguage) return selectedLanguage;
  try {
    const stored = localStorage.getItem(LANGUAGE_STORAGE_KEY);
    if (isLanguage(stored)) return stored;
  } catch { /* Use the system language when storage is unavailable. */ }
  return DEFAULT_LANGUAGE;
}

export const guiLocale = () => getLocale(guiLanguage());

/** Only call for application copy; never translate conversation content or user data. */
export function guiText(source: string, values: Record<string, string | number> = {}, language?: Language): string {
  language ??= guiLanguage();
  const text = language === "ru" ? messages[source] ?? source : source;
  return text.replace(/\{(\w+)\}/g, (placeholder, key: string) =>
    Object.hasOwn(values, key) ? String(values[key]) : placeholder);
}
