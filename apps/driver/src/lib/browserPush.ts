// The mobile website's service worker and web push (O4 step 5; browser only: imported by the web root and the .web
// screens). The worker is public/sw.js under /m/ (scope /m/: the desktop site's /sw.js keeps "/"): the offline page, the
// office's pushes and a tap opening its place. Push uses the office's existing web push: the key from
// my_notification_settings, register_web_push / remove_web_push, as the desktop site's Settings → Notifications.

import type { BrowserPushState } from '@/office/browserPushLogic';
import { keyBytes, sitePath } from '@/office/browserPushLogic';

const SCOPE = '/m/';
const WORKER = '/m/sw.js';

/** Registers the worker and passes a notification tap's link (a desktop path) to the page. */
export function registerMobileWorker(onNavigate: (path: string) => void): () => void {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return () => {};
  navigator.serviceWorker.register(WORKER, { scope: SCOPE }).catch((e: unknown) => console.warn('service worker', e));
  const onMessage = (ev: MessageEvent) => {
    const d = ev.data as { type?: string; url?: string } | null;
    if (!d || d.type !== 'navigate' || typeof d.url !== 'string') return;
    const path = sitePath(d.url, location.origin);
    if (path) onNavigate(path);
  };
  navigator.serviceWorker.addEventListener('message', onMessage);
  return () => navigator.serviceWorker.removeEventListener('message', onMessage);
}

/** The browser's own service-worker calls can wait forever (a worker that never activates): each has a limit, and the
 *  card says "not available right now" instead of waiting (no loading state runs forever). */
export const BROWSER_WAIT_MS = 10_000;
export function within<T>(p: Promise<T>, ms = BROWSER_WAIT_MS): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('too_slow')), ms);
    p.then((v) => { clearTimeout(timer); resolve(v); }, (e: unknown) => { clearTimeout(timer); reject(e); });
  });
}

/** The registration's worker active, within the limit (never navigator.serviceWorker.ready: it waits forever when no
 *  worker for the page becomes active). */
async function activeWorker(reg: ServiceWorkerRegistration, ms: number): Promise<ServiceWorkerRegistration> {
  if (reg.active) return reg;
  const worker = reg.installing ?? reg.waiting;
  if (!worker) throw new Error('too_slow');
  await within(new Promise<void>((resolve) => {
    worker.addEventListener('statechange', () => { if (worker.state === 'activated') resolve(); });
  }), ms);
  return reg;
}

const isIos = () => /iPhone|iPad|iPod/.test(navigator.userAgent);
const isInstalled = () =>
  window.matchMedia?.('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;

export function pushSupport(): 'ok' | 'unsupported' | 'insecure' | 'ios_not_installed' {
  if (typeof window === 'undefined') return 'unsupported';
  if (!('Notification' in window) || !('serviceWorker' in navigator) || !('PushManager' in window)) {
    return isIos() && !isInstalled() ? 'ios_not_installed' : 'unsupported';
  }
  if (!window.isSecureContext) return 'insecure';
  return 'ok';
}

async function registration(ms = BROWSER_WAIT_MS): Promise<ServiceWorkerRegistration | null> {
  const reg = await within(navigator.serviceWorker.getRegistration(SCOPE), ms);
  return reg && reg.scope.endsWith(SCOPE) ? reg : null;
}

export async function currentSubscription(ms = BROWSER_WAIT_MS): Promise<PushSubscription | null> {
  if (pushSupport() !== 'ok') return null;
  const reg = await registration(ms);
  return reg ? within(reg.pushManager.getSubscription(), ms) : null;
}

/** This browser's state; 'unavailable' when the browser does not answer within the limit. */
export async function browserPushState(ms = BROWSER_WAIT_MS): Promise<BrowserPushState> {
  const support = pushSupport();
  if (support !== 'ok') return support;
  if (Notification.permission === 'denied') return 'blocked';
  try {
    return (await currentSubscription(ms)) ? 'on' : 'off';
  } catch {
    return 'unavailable';
  }
}

export interface BrowserSubscription { endpoint: string; p256dh: string; auth: string; user_agent: string }

/** Asks for permission and subscribes. Throws 'blocked', 'no_permission' or 'too_slow' (the screen says it in words). */
export async function subscribeBrowser(publicKey: string, ms = BROWSER_WAIT_MS): Promise<BrowserSubscription> {
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error(permission === 'denied' ? 'blocked' : 'no_permission');
  const found = (await registration(ms)) ?? (await within(navigator.serviceWorker.register(WORKER, { scope: SCOPE }), ms));
  const reg = await activeWorker(found, ms);
  const sub = (await within(reg.pushManager.getSubscription(), ms))
    ?? (await within(reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) as BufferSource }), ms));
  const keys = sub.toJSON().keys ?? {};
  if (!keys.p256dh || !keys.auth) throw new Error('no_keys');
  return { endpoint: sub.endpoint, p256dh: keys.p256dh, auth: keys.auth, user_agent: navigator.userAgent.slice(0, 400) };
}

/** Unsubscribes; the endpoint that was removed (to tell the server), or null when there was none. */
export async function unsubscribeBrowser(): Promise<string | null> {
  const sub = await currentSubscription();
  if (!sub) return null;
  const endpoint = sub.endpoint;
  await sub.unsubscribe();
  return endpoint;
}
