// The three notification tools only the web build ever calls (a toggle, the browser's
// own push subscription on or off, a device removed). They live apart from the page so
// scripts/artifact-declaration.mjs can leave them out of the artifact's declaration: the
// artifact bundles the Settings → Notifications route and loads the person's settings
// (my_notification_settings) before saying the rest is on the web app, but never reaches
// these actions.
import type { NotificationSettings, SoundPrefs } from "../../data/types";
import { subscribePush, unsubscribePush } from "../../push";
import type { Transport } from "../../transport/types";

export const setEvent = (transport: Transport, event: string, enabled: boolean) =>
  transport.call<NotificationSettings>("set_my_notification_settings", { events: { [event]: enabled } });

/** Permission → the browser's subscription → registered for this person. */
export async function turnOnHere(transport: Transport, publicKey: string): Promise<NotificationSettings> {
  const sub = await subscribePush(publicKey);
  return transport.call<NotificationSettings>("register_web_push", { ...sub });
}

/** Unsubscribes the browser and tells the server; nothing to tell when there was no subscription. */
export async function turnOffHere(transport: Transport): Promise<NotificationSettings | undefined> {
  const endpoint = await unsubscribePush();
  return endpoint ? transport.call<NotificationSettings>("remove_web_push", { endpoint }) : undefined;
}

export const removeDevice = (transport: Transport, id: string) => transport.call<NotificationSettings>("remove_web_push", { id });

/** Hotfix 2 (B): the office site's sounds, on or off and the volume (0–100), for this person on every browser. */
export const setSound = (transport: Transport, sound: Partial<SoundPrefs>) =>
  transport.call<NotificationSettings>("set_my_notification_settings", { sound });
