// The mobile website's side of "which build a browser gets" (Phase 8, O4; the desktop site's apps/office/src/app/viewChoice.ts
// has the rule that sends a phone here): "Switch to desktop view" is remembered in this browser (localStorage `fleet.view`,
// read by both builds on the one origin), and the page a phone asked for on the desktop site (`?from=`) is kept across the
// sign-in. Browser only; nothing here runs in the app.

import { getJson, remove, setJson } from './kv';

export const VIEW_KEY = 'fleet.view';
const FROM_KEY = 'web.from';

/** "Switch to desktop view": remembered, then the desktop site. */
export function switchToDesktop(): void {
  try {
    window.localStorage.setItem(VIEW_KEY, 'desktop');
  } catch {
    // A browser that keeps nothing: the switch works for this visit only.
  }
  window.location.assign('/');
}

/** The desktop page a phone asked for (?from=/requests/<id>): kept until the person is signed in. Only the site's own paths. */
export function keepFrom(from: string | undefined): void {
  if (from && from.startsWith('/') && !from.startsWith('//')) setJson(FROM_KEY, from);
}

/** The kept page, once (it is forgotten as it is read). */
export function takeFrom(): string | null {
  const from = getJson<string>(FROM_KEY);
  if (from) remove(FROM_KEY);
  return from;
}
