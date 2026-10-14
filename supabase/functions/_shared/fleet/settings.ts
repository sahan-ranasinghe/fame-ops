// fleet_settings: the dispatch defaults an admin edits in Settings → Fleet
// (docs/dispatch-plan.md, section 6), with the built-in defaults for any key
// that has no row.

import type { Db } from "./db.ts";
import { ToolError, unwrap } from "./db.ts";

export interface RushHourBand {
  /** 0 = Sunday … 6 = Saturday (Asia/Colombo). */
  days: number[];
  from: string;
  to: string;
}

export interface RushHour {
  factor: number;
  centre: { lat: number; lng: number };
  radius_km: number;
  bands: RushHourBand[];
}

export interface Settings {
  dwell_min: Record<string, number>;
  buffer_min: number;
  base_place_id: string | null;
  avg_speed_kmh: number;
  road_factor: number;
  accept_within_min: number;
  accept_before_leave_min: number;
  rush_hour: RushHour;
  /** Off = every booking needs a driver: the "A driver is needed" box and the custodian-drives path are hidden. */
  self_drive_allowed: boolean;
  /** Snap to roads on the route maps: none, google_roads (secret GOOGLE_ROADS_KEY) or osrm (secret OSRM_URL). */
  map_matching: { provider: MapMatchingProvider };
  /** The driver app's "At work? Switch On duty" nudge: the time, on these days (0 = Sunday … 6 = Saturday); only while off duty. */
  shift_start: string;
  shift_days: number[];
  /** The items the driver ticks while recording a fuel video, in both languages (Phase 6, Part 3). */
  fuel_video_checklist: ChecklistItem[];
}

export interface ChecklistItem {
  key: string;
  en: string;
  si: string;
}

export type MapMatchingProvider = "none" | "google_roads" | "osrm";
export const MAP_MATCHING_PROVIDERS: MapMatchingProvider[] = ["none", "google_roads", "osrm"];

export const SETTINGS_DEFAULTS: Settings = {
  dwell_min: { "pickup.people": 10, "pickup.goods": 15, "drop.people": 5, "drop.goods": 15, visit: 60, documents: 10, default: 10 },
  buffer_min: 15,
  base_place_id: null,
  avg_speed_kmh: 35,
  road_factor: 1.3,
  accept_within_min: 30,
  accept_before_leave_min: 60,
  rush_hour: {
    factor: 1.3,
    centre: { lat: 6.9344, lng: 79.8428 },
    radius_km: 25,
    bands: [{ days: [1, 2, 3, 4, 5], from: "07:00", to: "09:30" }, { days: [1, 2, 3, 4, 5], from: "16:30", to: "19:00" }],
  },
  self_drive_allowed: true,
  map_matching: { provider: "none" },
  shift_start: "08:00",
  shift_days: [1, 2, 3, 4, 5, 6],
  fuel_video_checklist: [
    { key: "pump", en: "Pump display: litres and amount", si: "පොම්ප තිරය: ලීටර් සහ මුදල" },
    { key: "odometer", en: "Odometer", si: "ඔඩෝමීටරය" },
    { key: "plate", en: "Number plate", si: "අංක තහඩුව" },
  ],
};

export type SettingKey = keyof Settings;
export const SETTING_KEYS = Object.keys(SETTINGS_DEFAULTS) as SettingKey[];

export const SETTING_TEXT: Record<SettingKey, string> = {
  dwell_min: "Minutes at a stop by type and what is carried (pickup.people, drop.goods, visit, documents, default)",
  buffer_min: "Arrive this many minutes before a deadline",
  base_place_id: "The base place (the head office): the start and the return of a trip",
  avg_speed_kmh: "Average speed for the estimate when no routing key is set",
  road_factor: "Road distance = straight line × this, for the estimate",
  accept_within_min: "A driver should accept a task within this many minutes of receiving it",
  accept_before_leave_min: "… and at the latest this many minutes before the leave-by time",
  rush_hour: "Rush hour: the factor on legs that start or end within the radius of the centre during the bands (weekdays)",
  self_drive_allowed:
    "Self-drive bookings: a vehicle's custodian may drive it with no driver assigned (off = every booking needs a driver)",
  map_matching:
    "Snap to roads on the route maps: provider none, google_roads (Roads API, secret GOOGLE_ROADS_KEY) or osrm (self-hosted, secret OSRM_URL); km stay from the odometer",
  shift_start: "The driver app's shift nudge (\"At work? Switch On duty\"): the time of day, HH:MM, shown only to a driver who is off duty",
  shift_days: "… on these days (0 = Sunday … 6 = Saturday); empty = never",
  fuel_video_checklist:
    "What the driver shows while recording a fuel video: a list of items { key, en, si } (1 to 8), ticked on the phone and kept with the entry",
};

const isTime = (s: unknown) => typeof s === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
const isUuid = (s: unknown) => typeof s === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);

function number(value: unknown, key: string, min: number, max: number, integer = false): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) {
    throw new ToolError(`${key}: a ${integer ? "whole " : ""}number from ${min} to ${max} is needed.`);
  }
  return value;
}

/** The value a key accepts, checked; throws a ToolError that says what is wrong. */
export function validateSetting(key: SettingKey, value: unknown): Settings[SettingKey] {
  switch (key) {
    case "dwell_min": {
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new ToolError("dwell_min: an object of minutes by stop kind is needed.");
      }
      const out: Record<string, number> = {};
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        if (!/^(pickup|drop|visit)(\.(people|goods|documents|other))?$|^(people|goods|documents|other|default)$/.test(k)) {
          throw new ToolError(`dwell_min: "${k}" is not a stop kind (pickup.people, drop.goods, visit, documents, default …).`);
        }
        out[k] = number(v, `dwell_min.${k}`, 0, 1440, true);
      }
      if (out.default === undefined) throw new ToolError("dwell_min needs a default.");
      return out;
    }
    case "buffer_min":
      return number(value, key, 0, 600, true);
    case "base_place_id":
      if (value === null) return null;
      if (!isUuid(value)) throw new ToolError("base_place_id: the id of a saved place, or null.");
      return value as string;
    case "avg_speed_kmh":
      return number(value, key, 5, 120);
    case "road_factor":
      return number(value, key, 1, 3);
    case "accept_within_min":
    case "accept_before_leave_min":
      return number(value, key, 1, 1440, true);
    case "self_drive_allowed":
      if (typeof value !== "boolean") throw new ToolError("self_drive_allowed: true or false.");
      return value;
    case "shift_start":
      if (!isTime(value)) throw new ToolError("shift_start: a time of day, HH:MM.");
      return value as string;
    case "shift_days": {
      if (!Array.isArray(value) || !value.every((d) => Number.isInteger(d) && d >= 0 && d <= 6)) {
        throw new ToolError("shift_days: a list of days, 0 = Sunday … 6 = Saturday (for example [1, 2, 3, 4, 5, 6]).");
      }
      return [...new Set(value as number[])].sort((a, b) => a - b);
    }
    case "fuel_video_checklist": {
      if (!Array.isArray(value) || value.length < 1 || value.length > 8) throw new ToolError("fuel_video_checklist: a list of 1 to 8 items { key, en, si }.");
      const keys = new Set<string>();
      return value.map((item, i) => {
        const it = (item ?? {}) as Record<string, unknown>;
        const key = typeof it.key === "string" ? it.key.trim().toLowerCase().replace(/[^a-z0-9_]+/g, "_").slice(0, 30) : "";
        const en = typeof it.en === "string" ? it.en.trim().slice(0, 60) : "";
        const si = typeof it.si === "string" ? it.si.trim().slice(0, 60) : "";
        if (!key || !en) throw new ToolError(`fuel_video_checklist: item ${i + 1} needs a key and an English text (si may repeat the English).`);
        if (keys.has(key)) throw new ToolError(`fuel_video_checklist: the key "${key}" is used twice.`);
        keys.add(key);
        return { key, en, si: si || en };
      });
    }
    case "map_matching": {
      const provider = (value as { provider?: unknown } | null)?.provider;
      if (!value || typeof value !== "object" || !MAP_MATCHING_PROVIDERS.includes(provider as MapMatchingProvider)) {
        throw new ToolError("map_matching: an object { provider: none | google_roads | osrm }.");
      }
      return { provider: provider as MapMatchingProvider };
    }
    case "rush_hour": {
      const r = value as Partial<RushHour> | null;
      if (!r || typeof r !== "object") throw new ToolError("rush_hour: an object with factor, centre, radius_km and bands is needed.");
      const bands = Array.isArray(r.bands) ? r.bands : null;
      if (!bands) throw new ToolError("rush_hour.bands: a list is needed.");
      for (const b of bands) {
        if (
          !Array.isArray(b.days) || !b.days.every((d) => Number.isInteger(d) && d >= 0 && d <= 6) || !isTime(b.from) || !isTime(b.to) ||
          b.from >= b.to
        ) {
          throw new ToolError("rush_hour.bands: each band needs days (0 = Sunday … 6 = Saturday), from and to (HH:MM, from before to).");
        }
      }
      return {
        factor: number(r.factor, "rush_hour.factor", 1, 3),
        centre: {
          lat: number(r.centre?.lat, "rush_hour.centre.lat", -90, 90),
          lng: number(r.centre?.lng, "rush_hour.centre.lng", -180, 180),
        },
        radius_km: number(r.radius_km, "rush_hour.radius_km", 1, 500),
        bands: bands.map((b) => ({ days: [...b.days], from: b.from, to: b.to })),
      };
    }
  }
}

/** Every setting, the stored value where there is one, the default otherwise. */
export async function loadSettings(db: Db): Promise<Settings> {
  const rows = unwrap(await db.from("fleet_settings").select("key, value"), "fleet settings");
  const out: Settings = structuredClone(SETTINGS_DEFAULTS);
  for (const row of rows) {
    if (!SETTING_KEYS.includes(row.key as SettingKey)) continue;
    try {
      (out as unknown as Record<string, unknown>)[row.key] = validateSetting(row.key as SettingKey, row.value);
    } catch {
      // A bad stored value is ignored in favour of the default (update_settings never stores one).
    }
  }
  return out;
}

export async function saveSetting(db: Db, key: SettingKey, value: Settings[SettingKey], by: string): Promise<void> {
  unwrap(
    await db.from("fleet_settings").upsert({ key, value: value as never, updated_at: new Date().toISOString(), updated_by: by }, {
      onConflict: "key",
    }),
    "fleet settings",
  );
}
