// The mobile website's web push (O4 step 5), the pure rules: the state of this browser in words (the desktop site's
// Settings → Notifications says the same, apps/office/src/screens/settings/notificationsLogic.ts), the VAPID key bytes and
// the endpoint's label as the server keeps it. The browser calls are in lib/browserPush.ts.

export type BrowserPushState = 'unsupported' | 'insecure' | 'ios_not_installed' | 'blocked' | 'on' | 'off';

export interface BrowserPushLine {
  /** The i18n key under web.push. */
  key: string;
  tone: 'ok' | 'danger' | 'info' | 'warn';
  /** The one button that makes sense: turn it on, turn it off, or none. */
  can: 'on' | 'off' | null;
}

/** The line about this browser. `registered` = the server knows this browser's subscription for this person. */
export function browserPushLine(state: BrowserPushState, configured: boolean, registered: boolean): BrowserPushLine {
  if (!configured) return { key: 'notConfigured', tone: 'info', can: null };
  switch (state) {
    case 'unsupported': return { key: 'unsupported', tone: 'info', can: null };
    case 'insecure': return { key: 'insecure', tone: 'info', can: null };
    case 'ios_not_installed': return { key: 'iosInstall', tone: 'info', can: null };
    case 'blocked': return { key: 'blocked', tone: 'danger', can: null };
    case 'on': return registered ? { key: 'on', tone: 'ok', can: 'off' } : { key: 'onNotYou', tone: 'info', can: 'on' };
    case 'off': return { key: 'off', tone: 'warn', can: 'on' };
  }
}

/** The VAPID public key (base64url) as the bytes pushManager.subscribe wants. */
export function keyBytes(base64: string): Uint8Array {
  const clean = base64.trim();
  const padded = clean + '='.repeat((4 - (clean.length % 4)) % 4);
  const raw = atob(padded.replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

/** The first 16 hex characters of the endpoint's SHA-256: the server's label for a browser (endpoint_hash). */
export async function endpointHash(endpoint: string): Promise<string> {
  if (!globalThis.crypto?.subtle) return '';
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(endpoint));
  return [...new Uint8Array(digest)].slice(0, 8).map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** A link a notification or the page's worker passed (a desktop path) as a path of this site, or null. */
export function sitePath(url: string, origin: string): string | null {
  try {
    const u = new URL(url, origin);
    return u.origin === origin ? u.pathname + u.search : null;
  } catch {
    return null;
  }
}
