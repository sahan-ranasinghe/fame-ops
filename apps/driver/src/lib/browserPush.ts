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

async function registration(): Promise<ServiceWorkerRegistration | null> {
  const reg = await navigator.serviceWorker.getRegistration(SCOPE);
  return reg && reg.scope.endsWith(SCOPE) ? reg : null;
}

export async function currentSubscription(): Promise<PushSubscription | null> {
  if (pushSupport() !== 'ok') return null;
  const reg = await registration();
  return reg ? reg.pushManager.getSubscription() : null;
}

export async function browserPushState(): Promise<BrowserPushState> {
  const support = pushSupport();
  if (support !== 'ok') return support;
  if (Notification.permission === 'denied') return 'blocked';
  return (await currentSubscription()) ? 'on' : 'off';
}

export interface BrowserSubscription { endpoint: string; p256dh: string; auth: string; user_agent: string }

/** Asks for permission and subscribes. Throws 'blocked' or 'no_permission' (the screen says it in words). */
export async function subscribeBrowser(publicKey: string): Promise<BrowserSubscription> {
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error(permission === 'denied' ? 'blocked' : 'no_permission');
  const reg = (await registration()) ?? (await navigator.serviceWorker.register(WORKER, { scope: SCOPE }));
  await navigator.serviceWorker.ready;
  const sub = (await reg.pushManager.getSubscription())
    ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) as BufferSource }));
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
