// All UI text lives in en.json and si.json. Nothing is hard-coded in screens.

import { getLocales } from 'expo-localization';

import en from './en.json';
import si from './si.json';

export type Language = 'en' | 'si';

const strings: Record<Language, unknown> = { en, si };

/** The phone's language when it is Sinhala, otherwise English. */
export function deviceLanguage(): Language {
  return getLocales()[0]?.languageCode === 'si' ? 'si' : 'en';
}

function lookup(source: unknown, key: string): string | undefined {
  let node = source;
  for (const part of key.split('.')) {
    if (typeof node !== 'object' || node === null) return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  return typeof node === 'string' ? node : undefined;
}

/** Text for a key such as "shell.ready". Falls back to English, then to the key itself. */
export function translate(language: Language, key: string): string {
  return lookup(strings[language], key) ?? lookup(strings.en, key) ?? key;
}
