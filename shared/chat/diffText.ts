import { createContext, useContext } from 'react';

export type DiffTranslate = (source: string, values?: Record<string, string | number>) => string;
const translate: DiffTranslate = (source, values = {}) => source.replace(/\{(\w+)\}/g,
  (placeholder, key: string) => Object.hasOwn(values, key) ? String(values[key]) : placeholder);

/** Diff labels follow the host's language without translating paths or code. */
export const DiffTextContext = createContext<DiffTranslate>(translate);
export const useDiffText = () => useContext(DiffTextContext);
