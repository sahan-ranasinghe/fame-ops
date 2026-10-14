// Pure rules of Settings → Notifications: the push state in words, the VAPID key bytes.

export type PushState = "unsupported" | "insecure" | "ios_not_installed" | "blocked" | "on" | "off";

export interface StateText {
  text: string;
  tone: "" | "ok" | "bad" | "info";
  /** Which button makes sense: turn it on, turn it off, or none. */
  can: "on" | "off" | null;
}

/** The line under "This browser". `registered` = this browser's subscription is known to the server for this person. */
export function stateText(state: PushState, configured: boolean, registered: boolean): StateText {
  if (!configured) return { text: "Push notifications are not switched on for the office yet.", tone: "info", can: null };
  switch (state) {
    case "unsupported":
      return { text: "This browser cannot show push notifications. Use Chrome, Edge or Firefox.", tone: "info", can: null };
    case "insecure":
      return { text: "Notifications need the https address of Fame Fleet.", tone: "info", can: null };
    case "ios_not_installed":
      return {
        text: "On an iPhone or iPad, first add Fame Fleet to the Home Screen (Share → Add to Home Screen), then open it from there.",
        tone: "info",
        can: null,
      };
    case "blocked":
      return { text: "Notifications are blocked for this site in the browser. Allow them in the site settings, then try again.", tone: "bad", can: null };
    case "on":
      return registered
        ? { text: "Notifications are on in this browser.", tone: "ok", can: "off" }
        : { text: "This browser has notifications on, but not for you yet.", tone: "info", can: "on" };
    case "off":
      return { text: "Notifications are off in this browser.", tone: "", can: "on" };
  }
}

export const DEVICE_NOTE =
  "Android: works best with Fame Fleet installed from the browser menu (Add to Home screen). " +
  "A laptop: the browser must be running. iPhone: add Fame Fleet to the Home Screen first.";

/** The VAPID public key (base64url) as the bytes pushManager.subscribe wants. */
export function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padded = base64.trim() + "=".repeat((4 - (base64.trim().length % 4)) % 4);
  const raw = atob(padded.replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}
