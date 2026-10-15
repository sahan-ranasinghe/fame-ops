// The Google package's tools (Phase 6, Part 5): the map load the web records before it loads
// Google's map, and the usage per feature for Settings → Fleet.

import { z } from "zod";
import type { Db } from "../db.ts";
import { unwrap } from "../db.ts";
import { FEATURE_TEXT, googleUse, refusedNote, takeGoogleCall } from "../google.ts";
import { GOOGLE_FEATURES, type GoogleFeature, loadSettings, type Settings } from "../settings.ts";
import { colomboDate } from "../time.ts";
import { tool } from "../tool.ts";

export interface FeatureUsage {
  feature: GoogleFeature;
  label: string;
  today: number;
  day_cap: number;
  month: number;
  month_cap: number;
  refused_today: number;
  /** In use now: the package, the key and both caps allow it. */
  on: boolean;
  /** Why not, when it is not. */
  note?: string;
}

/** Today's and this month's counts per feature (Colombo time), against the caps. */
export async function googleUsage(db: Db, settings: Settings, now: Date): Promise<FeatureUsage[]> {
  const today = colomboDate(now);
  const monthStart = `${today.slice(0, 8)}01`;
  const rows = unwrap(
    await db.from("google_calls").select("feature, day, calls, refused").gte("day", monthStart).lte("day", today),
    "google calls",
  );
  const use = googleUse(settings);
  const inUse: Record<GoogleFeature, boolean> = {
    map_loads: use.map,
    places_autocomplete: use.places,
    places_details: use.places,
    routes: use.routes,
    roads: use.roads,
  };
  return GOOGLE_FEATURES.map((feature) => {
    const mine = rows.filter((r) => r.feature === feature);
    const todayRow = mine.find((r) => r.day === today);
    const cap = settings.google_caps[feature];
    const usage = {
      feature,
      label: FEATURE_TEXT[feature],
      today: todayRow?.calls ?? 0,
      day_cap: cap.day,
      month: mine.reduce((n, r) => n + r.calls, 0),
      month_cap: cap.month,
      refused_today: todayRow?.refused ?? 0,
    };
    let note: string | undefined;
    if (!inUse[feature]) {
      note = settings.map_package === "open"
        ? "The open package is chosen"
        : feature === "roads" && use.places && !use.map
        ? "Needs the map key too (its lines go on Google's map only)"
        : "No key set";
    } else if (cap.day === 0 || cap.month === 0) note = refusedNote(feature, "day", { allowed: false, day_cap: cap.day, month_cap: cap.month });
    else if (usage.month >= cap.month) note = refusedNote(feature, "month");
    else if (usage.today >= cap.day) note = refusedNote(feature, "day");
    return { ...usage, on: inUse[feature] && !note, ...(note ? { note } : {}) };
  });
}

export const registerMapLoad = tool({
  name: "register_map_load",
  title: "Record a Google map load",
  description: "The web app asks this once per browser tab before it loads Google's map: the load is counted first (the map " +
    "loads cap) and only then is the browser key handed over. Refused (the open package, no key, a cap, the counter): no key, " +
    "and the note says why; the page then shows its lists without a map. Web only.",
  readOnly: false,
  input: z.object({}),
  async run(_args, { db, actor }) {
    const settings = await loadSettings(db);
    const use = googleUse(settings);
    const key = Deno.env.get("GOOGLE_MAPS_JS_KEY");
    if (actor.channel !== "web") {
      return { result: { allowed: false, package: use.package, note: "Google's map loads in the web app only" }, summary: "map load: not web" };
    }
    if (!use.map || !key) {
      return { result: { allowed: false, package: use.package, map: "open" }, summary: "map load: open package" };
    }
    const gate = await takeGoogleCall(db, "map_loads", settings.google_caps);
    if (!gate.allowed) {
      const note = refusedNote("map_loads", gate.reason, gate);
      return { result: { allowed: false, package: "google", map: "none", note, reason: gate.reason }, summary: `map load refused (${gate.reason})` };
    }
    return {
      result: { allowed: true, package: "google", map: "google", key, today: gate.day, day_cap: gate.day_cap, month: gate.month, month_cap: gate.month_cap },
      summary: `map load ${gate.day}/${gate.day_cap} today`,
    };
  },
});
