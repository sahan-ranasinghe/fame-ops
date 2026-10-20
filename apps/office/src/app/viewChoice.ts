// Which build a browser gets (Phase 8, O4; docs/mobile-website.md): a phone opening the office site gets the mobile website
// (/m/: Office mode's own screens), a laptop the desktop site. "Switch to desktop view" / "Switch to mobile view" is
// remembered in this browser (localStorage `fleet.view`), read by both builds (one origin). The mobile build has the same
// rule in apps/driver/src/lib/viewChoice.ts.

export const VIEW_KEY = "fleet.view";
export type ViewChoice = "desktop" | "mobile";

/** A phone: a narrow screen (the site's one breakpoint, ui/phone.ts) or a mobile browser (an iPad keeps the desktop site). */
export function phoneLike(width: number, userAgent: string): boolean {
  if (width <= 768) return true;
  return /Android.+Mobile|iPhone|iPod|Windows Phone|Mobile Safari/.test(userAgent) && !/iPad/.test(userAgent);
}

/** Pages the desktop site keeps on a phone too: the public privacy page and the set-password link's landing. */
const DESKTOP_ONLY = /^\/(privacy|set-password)(\/|$)/;

/** Where a phone is sent from a desktop page, or null to stay: /m/, with the page asked for as ?from= (the mobile site
 *  opens its own screen for it after sign-in). */
export function mobileTarget(path: string, search: string, choice: string | null, width: number, userAgent: string): string | null {
  if (DESKTOP_ONLY.test(path)) return null;
  if (choice === "desktop") return null;
  if (choice !== "mobile" && !phoneLike(width, userAgent)) return null;
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
