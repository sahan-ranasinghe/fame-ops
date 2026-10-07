// All UI text lives in en.json and si.json. Nothing is hard-coded in screens.
// Numbers, plates, times and amounts stay in Latin digits in both languages.

import { getLocales } from 'expo-localization';

import type { Language } from '../lib/types';
import en from './en.json';
import si from './si.json';

const strings: Record<Language, unknown> = { en, si };

/** The phone's language when it is Sinhala, otherwise English. */
export function deviceLanguage(): Language {
  return getLocales()[0]?.languageCode === 'si' ? 'si' : 'en';
}

function lookup(source: unknown, key: string): unknown {
  let node = source;
  for (const part of key.split('.')) {
    if (typeof node !== 'object' || node === null) return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  return node;
}

export type Vars = Record<string, string | number>;

/**
 * Text for a key such as "today.startTask", with {name} placeholders filled in.
 * Falls back to English, then to the key itself.
 */
export function translate(language: Language, key: string, vars?: Vars): string {
  const found = lookup(strings[language], key) ?? lookup(strings.en, key);
  let text = typeof found === 'string' ? found : key;
  if (vars) {
    for (const [name, value] of Object.entries(vars)) text = text.replaceAll(`{${name}}`, String(value));
  }
  return text;
}

/** A list such as "days" or "months". */
export function translateList(language: Language, key: string): string[] {
  const found = lookup(strings[language], key) ?? lookup(strings.en, key);
  return Array.isArray(found) ? (found as string[]) : [];
}
