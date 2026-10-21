// The strings' keys, pure (only the two JSON files): for code the Node test scripts load, which must not pull in React
// Native (src/i18n/index.ts imports expo-localization).
import en from './en.json';

function lookup(source: unknown, key: string): unknown {
  let node = source;
  for (const part of key.split('.')) {
    if (typeof node !== 'object' || node === null) return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  return node;
}

/** Does a key have text at all (every key exists in English first)? For code that has only t(). */
export function keyExists(key: string): boolean {
  return typeof lookup(en, key) === 'string';
}
