// One breakpoint for the layout: at 768 px and under the app is a phone (bottom
// tab bar, full-screen detail pages, cards instead of tables, sticky buttons).
// The CSS uses the same width; this hook lets components choose what to render.
import { useEffect, useState } from "react";

export const PHONE_MAX_PX = 768;
export const PHONE_QUERY = `(max-width: ${PHONE_MAX_PX}px)`;

const match = () => typeof window !== "undefined" && typeof window.matchMedia === "function" ? window.matchMedia(PHONE_QUERY).matches : false;

export function useIsPhone(): boolean {
  const [phone, setPhone] = useState(match);
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia(PHONE_QUERY);
    const on = () => setPhone(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return phone;
}
