// One breakpoint for the layout: at 768 px and under the app is a phone (bottom
// tab bar, full-screen detail pages, cards instead of tables, sticky buttons).
// The CSS uses the same width; this hook lets components choose what to render.
//
// A change of the width only counts once it holds (PHONE_SETTLE_MS). Chromium's full-page capture (Playwright's
// `fullPage` screenshot: Page.captureScreenshot with captureBeyondViewport) lays the page out for a moment at a viewport a
// few pixels wide: every max-width query fires "change", the phone's among them, and is back at the real width a moment
// later. Followed at once, that turned the page into its phone layout and back, which remounted it (its store entries
// released and asked again: CI's mockup picture caught the task page "Loading the task…" and the board's skeletons). A
// height change (a phone's address bar showing or hiding) never touches this query. A real change of width (a window
// made narrower, a tablet turned) is followed PHONE_SETTLE_MS later; the CSS follows it at once.
import { useEffect, useState } from "react";

export const PHONE_MAX_PX = 768;
export const PHONE_QUERY = `(max-width: ${PHONE_MAX_PX}px)`;
/** How long a change of the phone query must hold before the layout follows it. */
export const PHONE_SETTLE_MS = 250;

const match = () => typeof window !== "undefined" && typeof window.matchMedia === "function" ? window.matchMedia(PHONE_QUERY).matches : false;

export function useIsPhone(): boolean {
  const [phone, setPhone] = useState(match);
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia(PHONE_QUERY);
    let timer: ReturnType<typeof setTimeout> | undefined;
    // Every change starts the wait again; the query is read when it ends (a flip and its way back = no change).
    const settle = () => {
      clearTimeout(timer);
      timer = setTimeout(() => setPhone(mq.matches), PHONE_SETTLE_MS);
    };
    setPhone(mq.matches);
    mq.addEventListener("change", settle);
    return () => {
      clearTimeout(timer);
      mq.removeEventListener("change", settle);
    };
  }, []);
  return phone;
}
