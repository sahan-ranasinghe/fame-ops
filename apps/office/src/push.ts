// Web push in the browser (web build only): the service worker, whether push can
// work here, the current subscription, turning it on (permission →
// pushManager.subscribe) and off. The pure parts (the key bytes, the texts) are
// in screens/settings/notificationsLogic.ts.
import { type PushState, urlBase64ToUint8Array } from "./screens/settings/notificationsLogic";

export interface BrowserSubscription {
  endpoint: string;
  p256dh: string;
  auth: string;
  user_agent: string;
}

/** Registers /sw.js (no caching: a redeploy is never stale) and passes a notification tap's link to the router. */
export function registerServiceWorker(onNavigate: (path: string) => void): () => void {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return () => {};
  navigator.serviceWorker.register("/sw.js").catch((e: unknown) => console.warn("service worker", e));
  const onMessage = (ev: MessageEvent) => {
    const d = ev.data as { type?: string; url?: string } | null;
    if (!d || d.type !== "navigate" || typeof d.url !== "string") return;
    try {
      const u = new URL(d.url, location.origin);
      if (u.origin === location.origin) onNavigate(u.pathname + u.search + u.hash);
    } catch { /* not a link */ }
  };
  navigator.serviceWorker.addEventListener("message", onMessage);
  return () => navigator.serviceWorker.removeEventListener("message", onMessage);
}

const isIos = () => /iPhone|iPad|iPod/.test(navigator.userAgent);
const isInstalled = () => window.matchMedia?.("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;

/** Can push work in this browser, before asking anything. */
export function pushSupport(): "ok" | "unsupported" | "insecure" | "ios_not_installed" {
  if (typeof window === "undefined") return "unsupported";
  if (!("Notification" in window) || !("serviceWorker" in navigator) || !("PushManager" in window)) {
    return isIos() && !isInstalled() ? "ios_not_installed" : "unsupported";
  }
  if (!window.isSecureContext) return "insecure";
  return "ok";
}

export async function currentSubscription(): Promise<PushSubscription | null> {
  if (pushSupport() !== "ok") return null;
  const reg = await navigator.serviceWorker.getRegistration("/");
  return reg ? await reg.pushManager.getSubscription() : null;
}

export async function pushState(): Promise<PushState> {
  const support = pushSupport();
  if (support !== "ok") return support;
  if (Notification.permission === "denied") return "blocked";
  return (await currentSubscription()) ? "on" : "off";
}

/** Asks for permission and subscribes (the existing subscription comes back when there is one). */
export async function subscribePush(publicKey: string): Promise<BrowserSubscription> {
  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    throw new Error(permission === "denied"
      ? "Notifications are blocked for this site in the browser. Allow them in the site settings, then try again."
      : "No permission was given.");
  }
  const reg = (await navigator.serviceWorker.getRegistration("/")) ?? (await navigator.serviceWorker.register("/sw.js"));
  await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(publicKey) });
  const keys = sub.toJSON().keys ?? {};
  if (!keys.p256dh || !keys.auth) throw new Error("The browser gave no keys for the subscription.");
  return { endpoint: sub.endpoint, p256dh: keys.p256dh, auth: keys.auth, user_agent: navigator.userAgent.slice(0, 400) };
}

/** Unsubscribes; answers the endpoint that was removed (to tell the server), or null when there was none. */
export async function unsubscribePush(): Promise<string | null> {
  const sub = await currentSubscription();
  if (!sub) return null;
  const endpoint = sub.endpoint;
  await sub.unsubscribe();
  return endpoint;
}

/** The first 16 hex characters of the endpoint's SHA-256, as the server labels devices. */
export async function endpointHash(endpoint: string): Promise<string> {
  if (!globalThis.crypto?.subtle) return "";
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(endpoint));
  return [...new Uint8Array(digest)].slice(0, 8).map((b) => b.toString(16).padStart(2, "0")).join("");
}
