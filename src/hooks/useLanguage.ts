import { useCallback, useEffect, useState } from "react";
import { DEFAULT_LANGUAGE, LANGUAGE_STORAGE_KEY, isLanguage, translate, type Language } from "../i18n";

function storedLanguage(): Language {
  const value = window.localStorage.getItem(LANGUAGE_STORAGE_KEY);
  return isLanguage(value) ? value : DEFAULT_LANGUAGE;
}

export function useLanguage() {
  const [language, setLanguage] = useState<Language>(storedLanguage);

  useEffect(() => {
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
    document.documentElement.lang = language === "zh" ? "zh-CN" : "en";
  }, [language]);

  const t = useCallback((key: Parameters<typeof translate>[1], values?: Parameters<typeof translate>[2]) => (
    translate(language, key, values)
  ), [language]);

  return { language, setLanguage, t };
}
