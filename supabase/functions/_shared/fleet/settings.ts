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
}

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
