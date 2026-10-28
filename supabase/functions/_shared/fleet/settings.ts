// fleet_settings: the dispatch defaults an admin edits in Settings → Fleet
// (docs/dispatch-plan.md, section 6), with the built-in defaults for any key
// that has no row.

import type { Db } from "./db.ts";
import { ToolError, unwrap } from "./db.ts";
import { phoneE164 } from "./format.ts";

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

/** Round 4–7 (item 9): the days each kind of data is kept (Slack / Google Workspace / Samsara retention policies). */
export interface Retention {
  inbox_read_days: number;
  inbox_unread_days: number;
  delivery_days: number;
  audit_routine_days: number;
  audit_changes_days: number;
  issues_resolved_days: number;
  location_days: number;
  heartbeats_days: number;
  counters_days: number;
  drafts_days: number;
  app_errors_days: number;
}
export const RETENTION_DEFAULTS: Retention = {
  inbox_read_days: 30,
  inbox_unread_days: 90,
  delivery_days: 14,
  audit_routine_days: 30,
  audit_changes_days: 730,
  issues_resolved_days: 365,
  location_days: 183,
  heartbeats_days: 90,
  counters_days: 90,
  drafts_days: 30,
  app_errors_days: 90,
};
/** The floors no one can go under: GPS 30 days, the activity log's changes 6 months. */
export const RETENTION_MINIMUMS: Partial<Record<keyof Retention, number>> = { location_days: 30, audit_changes_days: 183 };

export interface Settings {
  dwell_min: Record<string, number>;
  buffer_min: number;
  base_place_id: string | null;
  avg_speed_kmh: number;
  road_factor: number;
  accept_within_min: number;
  accept_before_leave_min: number;
  /** Phase 7 (§19): the driver's one "Accept or decline" reminder, this many minutes after the task was sent. */
  accept_reminder_min: number;
  rush_hour: RushHour;
  /** Off = every booking needs a driver: the "A driver is needed" box and the custodian-drives path are hidden. */
  self_drive_allowed: boolean;
  /** Phase 7 (§33): a task made by someone without the approve permission waits for an approver before it is sent. */
  tasks_need_approval: boolean;
  /** Phase 7 (§13): trips a driver starts: allowed (Company work preselected, Personal offered), default (Personal preselected), off (no Personal); ask_first is reserved and behaves as allowed. */
  driver_personal_trips: PersonalTrips;
  /** Hotfix 2 (F): the office's own number, E.164 (Call office in the driver app and on the requester's pages). */
  office_phone: string | null;
  /** Hotfix 2 (J): a task may be made with its vehicle chosen on the day or of a type (on after every phone has the update). */
  vehicle_on_the_day: boolean;
  /** Round 1 (21 October 2026): the trip forms suggest the leave time and each stop's stay in grey, and hint (amber) when a
   *  chosen time misses an arrive-by; off = just the fields. The planner never blocks either way. */
  planner_suggestions: boolean;
  /** Round 4–7 (Sahan, 22 October 2026): each feature of the round has its switch (Settings → Dispatch), on by default,
   *  so one can be switched off live: the vehicle check before work, the "Trip finished?" question and the 09:00 close of a
   *  no-app trip, the fuel card at Start task, passengers on trips, who holds a busy driver or vehicle (and Ask for it). */
  vehicle_check: boolean;
  trip_close_prompt: boolean;
  /** Round 4–7 (item 9): how long each kind of data is kept (days); the nightly retention job removes the rest. */
  retention: Retention;
  fuel_card: boolean;
  passengers: boolean;
  holder_contact: boolean;
  /** Snap to roads under the open package: none or osrm (secret OSRM_URL); under the google package Google's Roads API is used (google_caps.roads; 0 = off) and this is not read. */
  map_matching: { provider: MapMatchingProvider };
  /** The driver app's "At work? Start work" nudge: the time, on these days (0 = Sunday … 6 = Saturday); only while off duty. */
  shift_start: string;
  shift_days: number[];
  /** Part 3b (H1): where a morning ends and an afternoon starts when a driver is not available for half a day. */
  half_day_split: string;
  /** Phase 7: whoever is still on duty after this time (HH:MM Colombo) is clocked out, not while a task runs; "" = off. */
  duty_cutoff: string;
  /** The steps the driver shows in order while recording a fuel video, ticked one by one (Phase 6, Part 3 and 3b); the last unlocks Stop. */
  fuel_video_checklist: ChecklistItem[];
  /** The recording quality: 480p (about 1.0 Mbps, the default) or 720p (about 1.5 Mbps). */
  fuel_video_quality: VideoQuality;
  /** How many months the files stay before the monthly prune removes them: 6 or 12. */
  fuel_video_keep_months: 6 | 12;
  /** The map search's calls a day (openrouteservice geocode autocomplete), under the dashboard's quota; then only our places. */
  ors_autocomplete_daily_cap: number;
  /** … and a minute (the throttle, under the dashboard's 100 a minute shared by all geocoding). */
  ors_autocomplete_per_minute: number;
  /** The route views' estimated lines over gaps: openrouteservice directions calls a day (Part 5b), inside the directions budget. */
  ors_gap_daily_cap: number;
  /** google: Google's map, place search, road times and snapping where its keys exist; open: OpenFreeMap, openrouteservice, the estimate (Part 5). */
  map_package: MapPackage;
  /** Google calls a day and a month per feature (Colombo time); the month never above 95 % of Google's free usage. */
  google_caps: GoogleCaps;
  /** Part 6: how long a phone waits for Google's map to finish loading while online before it shows the free map (seconds). */
  phone_map_wait_s: number;
  /** Part 6: the contact e-mail on the public privacy page (/privacy); null = the page shows the office phone instead. */
  privacy_email: string | null;
  /** Round 48 (6a): the server's own Gemini odometer reads a day (check-odometer-photos), counted before each call; a driver's own 60 are fixed. */
  odometer_server_daily_cap: number;
}

export type MapPackage = "google" | "open";
export type GoogleFeature = "map_loads" | "places_autocomplete" | "places_details" | "routes" | "roads";
export const GOOGLE_FEATURES: GoogleFeature[] = ["map_loads", "places_autocomplete", "places_details", "routes", "roads"];
export type GoogleCaps = Record<GoogleFeature, { day: number; month: number }>;

/**
 * 95 % of each feature's free monthly usage (google_hard_ceiling() in the database says the same):
 * Dynamic Maps, Place Details Essentials and Autocomplete Requests 10,000 a month; Compute Routes Pro
 * and Roads (snap to roads) 5,000. No setting goes above these.
 */
export const GOOGLE_HARD_CEILING: Record<GoogleFeature, number> = {
  map_loads: 9500,
  places_autocomplete: 9500,
  places_details: 9500,
  routes: 4750,
  roads: 4750,
};

/** Working days in a month: a feature's daily cap is its month's ceiling ÷ this (Sahan, 17 October 2026). */
export const WORKING_DAYS_A_MONTH = 22;

/** The daily cap for a monthly ceiling: the ceiling spread over 22 working days, rounded down to a multiple of 5. */
export const dayCapFor = (month: number) => Math.floor(month / WORKING_DAYS_A_MONTH / 5) * 5;

/** Phase 7 (§26): snap to roads at 4,750 a month (95 % of the 5,000 free) ÷ 22 working days = 215 a day. */
export const ROADS_CAPS_PLANNED = { day: dayCapFor(4750), month: 4750 } as const;

export type VideoQuality = "480p" | "720p";
/** Phase 7 (§13): whether a driver may mark a trip they start as personal. */
export const PERSONAL_TRIPS = ["allowed", "default", "off", "ask_first"] as const;
export type PersonalTrips = (typeof PERSONAL_TRIPS)[number];

export interface ChecklistItem {
  key: string;
  en: string;
  si: string;
  /** The word on the office's timeline ("Plate 0:04"); the English text when missing. */
  short?: string;
}

export type MapMatchingProvider = "none" | "google_roads" | "osrm";
export const MAP_MATCHING_PROVIDERS: MapMatchingProvider[] = ["none", "google_roads", "osrm"];

export const SETTINGS_DEFAULTS: Settings = {
  // Phase 7 (§17): pickup and drop 5 minutes, a visit 1 hour; a place's usual time comes first.
  dwell_min: { pickup: 5, drop: 5, visit: 60, default: 5 },
  buffer_min: 15,
  base_place_id: null,
  avg_speed_kmh: 35,
  road_factor: 1.3,
  accept_within_min: 15,
  accept_before_leave_min: 30,
  accept_reminder_min: 5,
  rush_hour: {
    factor: 1.3,
    centre: { lat: 6.9344, lng: 79.8428 },
    radius_km: 25,
    bands: [{ days: [1, 2, 3, 4, 5], from: "07:00", to: "09:30" }, { days: [1, 2, 3, 4, 5], from: "16:30", to: "19:00" }],
  },
  self_drive_allowed: true,
  tasks_need_approval: true,
  driver_personal_trips: "allowed",
  office_phone: null,
  vehicle_on_the_day: false,
  planner_suggestions: true,
  vehicle_check: true,
  trip_close_prompt: true,
  retention: { ...RETENTION_DEFAULTS },
  fuel_card: true,
  passengers: true,
  holder_contact: true,
  map_matching: { provider: "none" },
  shift_start: "08:00",
  shift_days: [1, 2, 3, 4, 5],
  half_day_split: "13:00",
  duty_cutoff: "21:00",
  fuel_video_checklist: [
    { key: "plate", short: "Plate", en: "Number plate", si: "අංක තහඩුව" },
    { key: "zero", short: "Zero", en: "Pump display at zero before pumping", si: "පොම්ප කිරීමට පෙර පොම්ප තිරය බිංදුවේ" },
    { key: "pumping", short: "Pumping", en: "Pumping", si: "පොම්ප කරමින්" },
    { key: "final", short: "Final", en: "Final pump display: litres and amount", si: "අවසාන පොම්ප තිරය: ලීටර් සහ මුදල" },
  ],
  fuel_video_quality: "480p",
  fuel_video_keep_months: 12,
  ors_autocomplete_daily_cap: 2500,
  ors_autocomplete_per_minute: 90,
  ors_gap_daily_cap: 300,
  map_package: "google",
  // Each daily cap is the month's ceiling ÷ 22 working days (Sahan, 17 October 2026): 430 and 215. Weekends get the same
  // daily cap; the month's ceiling stays the hard stop.
  google_caps: {
    map_loads: { day: dayCapFor(9500), month: 9500 },
    places_autocomplete: { day: dayCapFor(9500), month: 9500 },
    places_details: { day: dayCapFor(9500), month: 9500 },
    routes: { day: dayCapFor(4750), month: 4750 },
    // On within the free usage (Sahan, 16 October 2026, Phase 7 §26): 215 a day, 4,750 a month, fail closed. The
    // Roads API policies say an asset tracking application "may be required to purchase an asset tracking license";
    // Fame decided to use snap to roads within the free usage, and a cap of 0 in Settings → Fleet turns it off if
    // Google asks (docs/google-maps-setup.md).
    roads: { ...ROADS_CAPS_PLANNED },
  },
  phone_map_wait_s: 30,
  privacy_email: null,
  odometer_server_daily_cap: 500,
};

export type SettingKey = keyof Settings;
export const SETTING_KEYS = Object.keys(SETTINGS_DEFAULTS) as SettingKey[];

export const SETTING_TEXT: Record<SettingKey, string> = {
  dwell_min: "Minutes at a stop by type (pickup, drop, visit, default); a place's usual time and a stop's own time come first",
  buffer_min: "Arrive this many minutes before a deadline",
  base_place_id: "The base place (the head office): the start and the return of a trip",
  avg_speed_kmh: "Average speed for the estimate when no routing key is set",
  road_factor: "Road distance = straight line × this, for the estimate",
  accept_within_min: "The accept window: a driver accepts a task within this many minutes of receiving it",
  accept_before_leave_min:
    "… and at the latest this many minutes before the leave-by time; after either, the task needs a driver (the office is told)",
  accept_reminder_min: "The driver's one reminder to accept or decline, this many minutes after the task was sent",
  rush_hour: "Rush hour: the factor on legs that start or end within the radius of the centre during the bands (weekdays)",
  self_drive_allowed:
    "Trips with no Fame Fleet driver: the person asking may drive it themselves (\"I'll drive myself\"), name someone else who drives (a name and a phone), or a vehicle's custodian drives it (off = every trip needs a driver)",
  tasks_need_approval:
    "New tasks need the fleet admin's OK: a task made by someone without the approve permission waits in the approval queue (Requests) with the proposed driver and vehicle, and is sent to the driver only when approved (off = sent at once)",
  office_phone:
    "The office's own number (Call office in the driver app and on the requester's pages): a Sri Lankan number, stored +94…; null clears it",
  vehicle_on_the_day:
    "A task may be made without a vehicle: the driver's vehicle on the day, or any vehicle of a type (the driver confirms it at Start task). Switch it on after every phone has the app update that knows it",
  planner_suggestions:
    "The trip forms suggest the leave time and each stop's stay (in grey, editable) and give a hint when a chosen time misses an arrive-by; off = just the fields, no suggestions. Never blocks a save",
  retention:
    "How long data is kept, in days (Settings → Data retention): notifications read / unread, delivery records, the activity log's routine entries and changes, resolved issues, location points (each driver's day stays as a summary), heartbeats, usage counters, unsent trip drafts, app errors. Business records are never removed. Minimums: location points 30, activity-log changes 183",
  vehicle_check:
    "The vehicle check before work: whenever a driver takes a vehicle, and before a self-drive or someone-else trip sets off, \"Any damage or problem with <plate>?\" (all good in one tap; a problem with photos becomes a pre-trip issue). Off = not asked",
  trip_close_prompt:
    "\"Trip finished? Enter the odometer\" for a trip nobody drives with the app (self-drive, someone else): asked at the back-by time or the duty cut-off, closed as Completed · not confirmed at 09:00 the next day when unanswered. Off = neither (the person can still finish it by hand)",
  fuel_card:
    "The fuel card at Start task: the trip's km and roughly how many litres it takes, and \"Enough fuel?\" (Yes / I'll fill up on the way). Advisory, never blocks. Off = not shown",
  passengers:
    "Passengers on trips: the Passengers field when asking for or assigning a trip; registered passengers are told about the trip and see it in My trips. Off = the field is hidden and nobody is told",
  holder_contact:
    "Who holds a busy driver or vehicle: the warning names them with Call and WhatsApp, and offers Ask for it. Off = the warning says only that it is busy",
  driver_personal_trips:
    "Trips a driver starts in the app (Start a trip): allowed = Company work preselected and Personal offered, default = Personal preselected, off = no Personal choice; ask_first is reserved (accepted, behaves as allowed until it is built). Personal km are counted apart and never charged to a job",
  map_matching:
    "Snap to roads under the open package: provider none or osrm (self-hosted, secret OSRM_URL); under the google package Google's Roads API snaps the web's Google map instead (its caps in google_caps.roads, 0 = off) and this setting is not read; km stay from the odometer",
  shift_start: 'The driver app\'s shift nudge ("At work? Start work"): the time of day, HH:MM, shown only to a driver who is off duty',
  shift_days: "… on these days (0 = Sunday … 6 = Saturday); empty = never",
  half_day_split:
    "Part 3b: when a driver is not available for half a day, the morning ends and the afternoon starts at this time, HH:MM (entries already saved keep their times)",
  duty_cutoff:
    'The end of the working day, HH:MM: a driver still on duty after it is clocked out by the server ("You were clocked out at 21:00"), but never while a task is in progress (then when it is completed); "" = off',
  fuel_video_checklist:
    "The steps the driver shows in order while recording a fuel video: a list of 1 to 8 { key, en, si, short? }, ticked one by one on the phone (the last unlocks Stop); each tick's second is kept with the entry and shown as a bookmark; short is the word on the office's timeline",
  fuel_video_quality:
    "The fuel video's quality on the phone: 480p (about 1.0 Mbps, a 5-minute fill is about 38 MB) or 720p (about 1.5 Mbps, about 56 MB)",
  fuel_video_keep_months: "How many months fuel videos are kept before the monthly prune removes the files: 6 or 12",
  ors_autocomplete_daily_cap:
    "The location search's map calls a day (openrouteservice geocode autocomplete; the dashboard's Geocoding quota of 3,000 a day is shared with search and reverse): after it only our own places show, with \"Map search limit reached for today\"; answers are cached 30 days and never count",
  ors_autocomplete_per_minute:
    '… and a minute (the dashboard allows 100 a minute for all geocoding): over it the box says "Map search is busy, try again in a minute"',
  ors_gap_daily_cap:
    "The route views' estimated lines: a gap of over 300 m and 60 s between two points is drawn as the likely road (openrouteservice, dashed, never km), each gap once (cached 30 days); this many new ones a day, inside the 1,900 directions calls a day shared with the road times",
  map_package:
    "The map package: google (Google's map, place search, traffic-aware road times and snap to roads, each where its key is set and under its caps) or open (OpenFreeMap, openrouteservice, the estimate); never mixed on one map",
  google_caps:
    "Google calls a day and a month per feature (map_loads, places_autocomplete, places_details, routes, roads; Colombo time): each call is counted before it is made (every autocomplete request, since a session ending in a pick still pays for its first 12) and refused at either cap, and the open package takes over until the next day or the 1st; the month at most 95 % of Google's free usage (9,500 for maps, autocomplete and place details; 4,750 for routes and roads); by default a day is the month ÷ 22 working days (430; 215), weekends the same",
  phone_map_wait_s:
    "The driver app's map: how many seconds a phone waits for Google's map to finish loading while it is online (1 to 120, 30 by default; 1 forces the free map for a test); after that the phone shows the free map (OpenFreeMap), the office gets an issue, and the phone tries Google again the next time the app opens",
  privacy_email:
    "The contact e-mail on the public privacy page (/privacy), shown as a mailto: link; null removes it and the page shows the office phone instead. Use Fame's shared address before the store submission",
  odometer_server_daily_cap:
    "The server's own odometer photo checks a day (Gemini, for readings typed with no connection; the pg_cron job check-odometer-photos): counted before each call and refused at the cap until the next Colombo day; a driver's own reads stay at 60 a day each. 0 pauses the checks",
};

const isTime = (s: unknown) => typeof s === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
/** One address, name@domain.tld, only the characters a mailto: link takes as they are (no ?, &, #, / or quotes). */
export const isEmail = (s: unknown) =>
  typeof s === "string" && s.length <= 254 && /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(s);
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
          throw new ToolError(`dwell_min: "${k}" is not a stop kind (pickup, drop, visit, default; or pickup.people, drop.goods …).`);
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
    case "accept_reminder_min":
      return number(value, key, 1, 1440, true);
    case "self_drive_allowed":
      if (typeof value !== "boolean") throw new ToolError("self_drive_allowed: true or false.");
      return value;
    case "tasks_need_approval":
      if (typeof value !== "boolean") throw new ToolError("tasks_need_approval: true or false.");
      return value;
    case "shift_start":
      if (!isTime(value)) throw new ToolError("shift_start: a time of day, HH:MM.");
      return value as string;
    case "half_day_split":
      if (!isTime(value)) throw new ToolError("half_day_split: a time of day, HH:MM.");
      return value as string;
    case "duty_cutoff":
      if (value !== "" && !isTime(value)) throw new ToolError('duty_cutoff: a time of day, HH:MM, or "" for off.');
      return value as string;
    case "shift_days": {
      if (!Array.isArray(value) || !value.every((d) => Number.isInteger(d) && d >= 0 && d <= 6)) {
        throw new ToolError("shift_days: a list of days, 0 = Sunday … 6 = Saturday (for example [1, 2, 3, 4, 5, 6]).");
      }
      return [...new Set(value as number[])].sort((a, b) => a - b);
    }
    case "fuel_video_checklist": {
      if (!Array.isArray(value) || value.length < 1 || value.length > 8) {
        throw new ToolError("fuel_video_checklist: a list of 1 to 8 steps { key, en, si, short? }, in order.");
      }
      const keys = new Set<string>();
      return value.map((item, i) => {
        const it = (item ?? {}) as Record<string, unknown>;
        const key = typeof it.key === "string" ? it.key.trim().toLowerCase().replace(/[^a-z0-9_]+/g, "_").slice(0, 30) : "";
        const en = typeof it.en === "string" ? it.en.trim().slice(0, 60) : "";
        const si = typeof it.si === "string" ? it.si.trim().slice(0, 60) : "";
        const short = typeof it.short === "string" ? it.short.trim().slice(0, 20) : "";
        if (!key || !en) {
          throw new ToolError(`fuel_video_checklist: step ${i + 1} needs a key and an English text (si may repeat the English).`);
        }
        if (keys.has(key)) throw new ToolError(`fuel_video_checklist: the key "${key}" is used twice.`);
        keys.add(key);
        return short ? { key, en, si: si || en, short } : { key, en, si: si || en };
      });
    }
    case "office_phone": {
      if (value === null || value === "") return null;
      const phone = typeof value === "string" ? phoneE164(value) : null;
      if (!phone) throw new ToolError("office_phone: a Sri Lankan number such as 011 234 5678 or 077 123 4567, or null.");
      return phone;
    }
    case "vehicle_on_the_day":
      if (typeof value !== "boolean") throw new ToolError("vehicle_on_the_day: true or false.");
      return value;
    case "planner_suggestions":
      if (typeof value !== "boolean") throw new ToolError("planner_suggestions: true or false.");
      return value;
    case "retention": {
      if (!value || typeof value !== "object" || Array.isArray(value)) throw new ToolError("retention: an object of days by kind.");
      const out: Retention = { ...RETENTION_DEFAULTS };
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        if (!(k in RETENTION_DEFAULTS)) throw new ToolError(`retention: "${k}" is not one of ${Object.keys(RETENTION_DEFAULTS).join(", ")}.`);
        const min = RETENTION_MINIMUMS[k as keyof Retention] ?? 1;
        out[k as keyof Retention] = number(v, `retention.${k}`, min, 3650, true);
      }
      return out;
    }
    case "vehicle_check":
    case "trip_close_prompt":
    case "fuel_card":
    case "passengers":
    case "holder_contact":
      if (typeof value !== "boolean") throw new ToolError(`${key}: true or false.`);
      return value;
    case "driver_personal_trips":
      if (!PERSONAL_TRIPS.includes(value as PersonalTrips)) {
        throw new ToolError(`driver_personal_trips: ${PERSONAL_TRIPS.join(", ")}.`);
      }
      return value as PersonalTrips;
    case "fuel_video_quality":
      if (value !== "480p" && value !== "720p") throw new ToolError("fuel_video_quality: 480p or 720p.");
      return value;
    case "ors_autocomplete_daily_cap":
      return number(value, key, 0, 100000, true);
    case "ors_autocomplete_per_minute":
      return number(value, key, 1, 100, true);
    case "ors_gap_daily_cap":
      return number(value, key, 0, 1900, true);
    case "map_package":
      if (value !== "google" && value !== "open") throw new ToolError("map_package: google or open.");
      return value;
    case "google_caps": {
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new ToolError(
          "google_caps: an object { feature: { day, month } } for map_loads, places_autocomplete, places_details, routes and roads.",
        );
      }
      const given = value as Record<string, { day?: unknown; month?: unknown } | undefined>;
      const unknown = Object.keys(given).filter((k) => !GOOGLE_FEATURES.includes(k as GoogleFeature));
      if (unknown.length) {
        throw new ToolError(
          `google_caps: "${unknown[0]}" is not a feature (map_loads, places_autocomplete, places_details, routes, roads).`,
        );
      }
      const out = {} as GoogleCaps;
      for (const f of GOOGLE_FEATURES) {
        const c = given[f];
        if (!c) throw new ToolError(`google_caps.${f}: { day, month } is needed.`);
        const month = number(c.month, `google_caps.${f}.month`, 0, GOOGLE_HARD_CEILING[f], true);
        out[f] = { day: number(c.day, `google_caps.${f}.day`, 0, month, true), month };
      }
      return out;
    }
    case "phone_map_wait_s":
      return number(value, key, 1, 120, true);
    case "odometer_server_daily_cap":
      return number(value, key, 0, 5000, true);
    case "privacy_email": {
      if (value === null || value === "") return null;
      const email = typeof value === "string" ? value.trim().toLowerCase() : "";
      if (!isEmail(email)) throw new ToolError("privacy_email: an e-mail address such as privacy@example.com, or null to remove it.");
      return email;
    }
    case "fuel_video_keep_months":
      if (value !== 6 && value !== 12) throw new ToolError("fuel_video_keep_months: 6 or 12.");
      return value;
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

/** Stores a setting with who changed it; null (a cleared base place) is kept as JSON null by the database function. */
export async function saveSetting(db: Db, key: SettingKey, value: Settings[SettingKey], by: string): Promise<void> {
  unwrap(await db.rpc("save_fleet_setting", { p_key: key, p_value: value as never, p_by: by }), "fleet settings");
}
