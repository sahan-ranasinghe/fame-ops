// Which build a browser gets (Phase 8, O4; docs/mobile-website.md): a phone opening the office site gets the mobile website
// (/m/: Office mode's own screens), a laptop the desktop site. "Switch to desktop view" / "Switch to mobile view" is
// remembered in this browser (localStorage `fleet.view`), read by both builds (one origin). The mobile build has the same
// rule in apps/driver/src/lib/viewChoice.ts.

export const VIEW_KEY = "fleet.view";
export type ViewChoice = "desktop" | "mobile";

/** A phone: a mobile browser (an iPad keeps the desktop site), or a narrow screen (the site's one breakpoint, ui/phone.ts)
 *  with a finger for a pointer. A laptop's window made narrow keeps the desktop site (its pointer is a mouse). */
export function phoneLike(width: number, userAgent: string, touch: boolean): boolean {
  if (/iPad/.test(userAgent)) return false;
  if (/Android.+Mobile|iPhone|iPod|Windows Phone|Mobile Safari/.test(userAgent)) return true;
  return width <= 768 && touch;
}

/** This browser's pointer is a finger (a phone or a tablet), not a mouse. */
export function touchPointer(): boolean {
  try {
    return window.matchMedia("(pointer: coarse)").matches;
  } catch {
    return false;
  }
}

/** Pages the desktop site keeps on a phone too: the public privacy page and the set-password link's landing. */
const DESKTOP_ONLY = /^\/(privacy|set-password)(\/|$)/;

/** Phones sent to the mobile website by themselves. OFF (Sahan, 20 October 2026): held until he has tested /m/ on his
 *  phone; until then only a browser that chose "Switch to mobile view" goes there. Turning it on = this line set to true
 *  and the site deployed. */
export const PHONE_REDIRECT = false;

/** Where a browser is sent from a desktop page, or null to stay: /m/, with the page asked for as ?from= (the mobile site
 *  opens its own screen for it after sign-in). A phone goes only while `redirect` is on; a browser that chose the mobile
 *  view always does. */
export function mobileTarget(path: string, search: string, choice: string | null, width: number, userAgent: string, touch: boolean, redirect = PHONE_REDIRECT): string | null {
  if (DESKTOP_ONLY.test(path)) return null;
  if (choice === "desktop") return null;
  if (choice !== "mobile" && (!redirect || !phoneLike(width, userAgent, touch))) return null;
  const from = path === "/" && !search ? "" : `?from=${encodeURIComponent(path + search)}`;
  return `/m/${from}`;
}

export function readChoice(): string | null {
  try {
    return window.localStorage.getItem(VIEW_KEY);
  } catch {
    return null;
  }
}

export function saveChoice(choice: ViewChoice): void {
  try {
    window.localStorage.setItem(VIEW_KEY, choice);
  } catch {
    // A browser that keeps nothing: the switch works for this visit only.
  }
}
