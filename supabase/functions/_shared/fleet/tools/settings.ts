// Fleet settings (docs/dispatch-plan.md, section 6) and the routing provider's usage.

import { z } from "zod";
import { ToolError, unwrap, unwrapMaybe } from "../db.ts";
import { ORS_DAILY_BUDGET, providerFromEnv } from "../routing.ts";
import {
  loadSettings,
  saveSetting,
  SETTING_KEYS,
  SETTING_TEXT,
  type SettingKey,
  SETTINGS_DEFAULTS,
  validateSetting,
} from "../settings.ts";
import { tool } from "../tool.ts";
import { googleUse } from "../google.ts";
import { googleUsage } from "./google.ts";

export const getSettings = tool({
  name: "get_settings",
  title: "Fleet settings",
  description:
    "The dispatch settings: dwell minutes by stop kind, the buffer before a deadline, the base place, the estimate's speed and " +
    "road factor, the accept windows, the rush-hour bands, whether self-drive bookings are allowed; with the defaults and what " +
    "each means. The routing provider in use. google: the map package in use, which keys are set (never the keys), and per " +
    "feature today's and this month's Google calls against the caps.",
  readOnly: true,
  input: z.object({}),
  async run(_args, { db, now }) {
    const settings = await loadSettings(db);
    const use = googleUse(settings);
    const base = settings.base_place_id
      ? unwrapMaybe(
        await db.from("places").select("id, name, address, lat, lng").eq(
          "id",
          settings.base_place_id,
        ).maybeSingle(),
        "base place",
      )
      : null;
    return {
      result: {
        settings,
        defaults: SETTINGS_DEFAULTS,
        about: SETTING_TEXT,
        base_place: base
          ? {
            id: base.id,
            name: base.name,
            address: base.address,
            has_pin: base.lat != null,
          }
          : null,
        routing_provider: providerFromEnv(Deno.env.get("ROUTING_PROVIDER")),
        google: {
          package: use.package,
          chosen: settings.map_package,
          configured: use.configured,
          in_use: {
            map: use.map,
            places: use.places,
            routes: use.routes,
            roads: use.roads,
          },
          usage: await googleUsage(db, settings, now),
        },
        note: settings.base_place_id
          ? undefined
          : "No base place set: plans start from the first stop. Pick the head office with update_settings (base_place_id).",
      },
      summary: "fleet settings",
    };
  },
});

export const updateSettings = tool({
  name: "update_settings",
  title: "Change a fleet setting",
  description:
    "Sets one setting: dwell_min (an object of minutes by stop kind), buffer_min, base_place_id (the id of a saved place with a " +
    "map pin, or null), avg_speed_kmh, road_factor, accept_within_min, accept_before_leave_min, rush_hour (factor, centre, radius_km, bands), " +
    "self_drive_allowed (true or false: may a vehicle's custodian drive it with no driver), map_package (google or open), " +
    "google_caps ({ feature: { day, month } } for map_loads, places_autocomplete, places_details, routes, roads; the month at " +
    "most 95 % of Google's free usage).",
  readOnly: false,
  input: z.object({
    key: z.enum(SETTING_KEYS as [SettingKey, ...SettingKey[]]),
    value: z.unknown().describe(
      "The new value, in the key's shape (get_settings shows the current one)",
    ),
  }),
  async run({ key, value }, { db, actor }) {
    const checked = validateSetting(key, value);
    if (key === "base_place_id" && checked) {
      const place = unwrapMaybe(
        await db.from("places").select("id, name, lat").eq(
          "id",
          checked as string,
        ).maybeSingle(),
        "base place",
      );
      if (!place) {
        throw new ToolError(
          "No saved place has that id. list_places shows them; add_place saves one.",
        );
      }
      if (place.lat == null) {
        throw new ToolError(
          `${place.name} has no map pin. The base place needs lat and lng (update it with add_place or pick another).`,
        );
      }
    }
    await saveSetting(db, key, checked, actor.name);
    return {
      result: { key, value: checked },
      summary: `setting ${key} = ${JSON.stringify(checked).slice(0, 120)}`,
    };
  },
});

export const routingUsage = tool({
  name: "routing_usage",
  title: "Routing calls per day",
  description:
    "How many road-time calls were made per day and provider (openrouteservice's free plan allows 2,000 a day; the fleet stops " +
    `at ${ORS_DAILY_BUDGET} and estimates after that), and the provider in use; google: today's and this month's Google calls ` +
    "per feature against the caps.",
  readOnly: true,
  input: z.object({
    days: z.number().int().min(1).max(90).optional().describe("Default 14"),
  }),
  async run({ days = 14 }, { db, now }) {
    const settings = await loadSettings(db);
    const since = new Date(now.getTime() - days * 86400000).toISOString().slice(
      0,
      10,
    );
    const rows = unwrap(
      await db.from("routing_calls").select("day, provider, calls, errors").gte(
        "day",
        since,
      ).order("day", { ascending: false }),
      "routing calls",
    );
    return {
      result: {
        provider: providerFromEnv(Deno.env.get("ROUTING_PROVIDER")),
        daily_budget: { ors: ORS_DAILY_BUDGET },
        days: rows,
        google: await googleUsage(db, settings, now),
      },
      summary: `routing usage, ${rows.length} rows`,
    };
  },
});
