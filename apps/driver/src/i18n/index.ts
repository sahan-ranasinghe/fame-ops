// All UI text lives in en.json and si.json. Nothing is hard-coded in screens.
// Numbers, plates, times and amounts stay in Latin digits in both languages.

import { getLocales } from 'expo-localization';

import type { Language } from '../lib/types';
import en from './en.json';
import si from './si.json';

export { keyExists } from './keys';

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

/** Is there text for this key (in the language, else English)? For a screen that shows something only when it exists. */
export function hasText(language: Language, key: string): boolean {
  return typeof (lookup(strings[language], key) ?? lookup(strings.en, key)) === 'string';
}

/**
 * Nothing internal is ever shown (Sahan, 21 October 2026): a missing key throws in the tests (jest, and the scripts with
 * FLEET_I18N_STRICT=1), and in the app it shows nothing, never the key ("office.status.Sent"), and says so once in the log.
 */
const STRICT = typeof process !== 'undefined' && (process.env.NODE_ENV === 'test' || process.env.FLEET_I18N_STRICT === '1');
const warned = new Set<string>();

/**
 * Text for a key such as "today.startTask", with {name} placeholders filled in. Falls back to English; a key with no text in
 * either shows nothing (and fails the tests).
 */
export function translate(language: Language, key: string, vars?: Vars): string {
  const found = lookup(strings[language], key) ?? lookup(strings.en, key);
  if (typeof found !== 'string') {
    if (STRICT) throw new Error(`No text for "${key}" (src/i18n/en.json and si.json)`);
    if (!warned.has(key)) {
      warned.add(key);
      console.warn(`[i18n] no text for ${key}`);
    }
    return '';
  }
  let text = found;
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
