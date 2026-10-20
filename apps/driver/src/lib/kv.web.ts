// The mobile website (Phase 8, O4): lib/kv on the browser's localStorage (the app keeps expo-sqlite's kv-store). The same
// functions and keys; a browser that refuses storage (a private window, blocked site data) reads nothing and keeps nothing,
// and the site still works, as it signs in again.

import { KEYS } from './kvKeys';

export { KEYS };

function store(): Storage | null {
  try {
    return typeof window !== 'undefined' && window.localStorage ? window.localStorage : null;
  } catch {
    return null;
  }
}

export function getJson<T>(key: string): T | null {
  try {
    const raw = store()?.getItem(key);
    return raw == null ? null : (JSON.parse(raw) as T);
  } catch {
    return null;
  }
}

export function setJson(key: string, value: unknown): void {
  try {
    store()?.setItem(key, JSON.stringify(value));
  } catch {
    // Full or refused: nothing kept.
  }
}

export function remove(key: string): void {
  try {
    store()?.removeItem(key);
  } catch {
    // Refused: nothing to remove.
  }
}
