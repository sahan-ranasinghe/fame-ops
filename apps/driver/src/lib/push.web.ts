// The mobile website (O4) has no Expo push: a browser is never registered as an Android phone. Web push for the office in a
// browser comes with step 5 (the service worker and register_web_push, as on the desktop site); until then nothing here.

export function pushToken(): string | null {
  return null;
}

export async function registerPush(): Promise<boolean> {
  return false;
}

export async function unregisterPush(): Promise<void> {}
