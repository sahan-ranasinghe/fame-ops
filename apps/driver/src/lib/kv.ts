// Small values kept on the phone (SQLite underneath): who is signed in, the
// last data seen, whether sharing is on. Readable from the background
// location task as well as from the screens.

import Storage from 'expo-sqlite/kv-store';

import { KEYS } from './kvKeys';

export { KEYS };

export function getJson<T>(key: string): T | null {
  const raw = Storage.getItemSync(key);
  if (raw == null) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function setJson(key: string, value: unknown): void {
  Storage.setItemSync(key, JSON.stringify(value));
}

export function remove(key: string): void {
  Storage.removeItemSync(key);
}

