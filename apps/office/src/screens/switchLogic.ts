// Round 4–7 (docs/phase8-plan.md §33): the five feature switches of Settings → Fleet, read by every surface. A switch is
// on unless it is saved off (absent = on). On the website a switched-off feature hides its part (the fresh reviewer, 22
// October 2026): the fuel card on a task (fuel_card), who rides by name with Share trip (passengers; the count stays), a
// vehicle's check section (vehicle_check), the Asks menu item, the Timeline's Asks button and a task's asks line with its
// poll (holder_contact). The server stops sending those parts too; the site hides them whatever an answer carries. Pure.
import type { FleetSettings } from "../data/types";

export type FeatureKey = "vehicle_check" | "trip_close_prompt" | "fuel_card" | "passengers" | "holder_contact";
export const FEATURE_KEYS: readonly FeatureKey[] = ["vehicle_check", "trip_close_prompt", "fuel_card", "passengers", "holder_contact"];

/** A feature switch as shown: off only when saved off (absent = on). */
export const featureOn = (s: Partial<FleetSettings> | null | undefined, key: FeatureKey): boolean => s?.[key] !== false;

/** The switches saved off. */
export const switchesOff = (s: Partial<FleetSettings> | null | undefined): FeatureKey[] => FEATURE_KEYS.filter((k) => !featureOn(s, k));

/** The menu items a switch hides while it is off (a direct link still opens the page: an older notification's). */
export const PAGE_SWITCH: Readonly<Record<string, FeatureKey>> = { holder_asks: "holder_contact" };

/** Is this menu item shown, given the switches that are off? */
export const pageSwitchedOn = (key: string, off: readonly FeatureKey[]): boolean => !PAGE_SWITCH[key] || !off.includes(PAGE_SWITCH[key]);
