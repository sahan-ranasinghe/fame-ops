// Google place search for the location search box and the stops (Phase 6, Part 5).
//
//   suggestions   Places Autocomplete (New), Sri Lanka only, biased to the base place, with the
//                 browser's session token; each request counted (places_autocomplete).
//   the pick      one Place Details (New) call with the Essentials fields only (location,
//                 formattedAddress, shortFormattedAddress, addressComponents) and the same
//                 session token (places_details); the name is the suggestion's. The answer is
//                 kept in google_pins by place id for at most 30 days (Places terms 14.3) and is
//                 never made one of our places (the terms allow keeping the place id only).
//   a stop        given a google_place_id, takes the kept pin while it lasts past the task's day,
//                 else fetches it again (one counted Details call); the trigger marks the stop so
//                 its Google details are removed 30 days after the fetch.

import type { Db } from "./db.ts";
import { unwrap, unwrapMaybe } from "./db.ts";
import {
  autocompleteRequest,
  autocompleteResponse,
  detailsRequest,
  detailsResponse,
  type Fetcher,
  GOOGLE_COORDS_DAYS,
  type GooglePrediction,
  googleUse,
  guarded,
  send,
} from "./google.ts";
import type { PlanPoint } from "./plan.ts";
import { loadSettings, type Settings } from "./settings.ts";

export const GOOGLE_MIN_CHARS = 3;
const DAY_MS = 86400000;

export interface GooglePin {
  google_place_id: string;
  lat: number;
  lng: number;
  address: string | null;
  short_address: string | null;
  district: string | null;
  /** ISO time of the Details call; the pin goes 30 days later. */
  fetched_at: string;
}

const serverKey = () => Deno.env.get("GOOGLE_SERVER_KEY") ?? undefined;

/** The suggestions for a text, or a note saying why there are none from Google. */
export async function googleSuggestions(
  db: Db,
  settings: Settings,
  text: string,
  opts: { session?: string | null; focus?: PlanPoint | null },
  fetchFn: Fetcher = fetch,
): Promise<{ places: GooglePrediction[]; note?: string }> {
  const key = serverKey();
  if (!googleUse(settings).places || !key) {
    return { places: [], note: "Google place search is not set up" };
  }
  if (text.trim().length < GOOGLE_MIN_CHARS) return { places: [] };
  const r = await guarded(
    db,
    "places_autocomplete",
    settings.google_caps,
    async () =>
      autocompleteResponse(
        await send(autocompleteRequest(text, key, opts), fetchFn),
      ),
  );
  return r.ok ? { places: r.value } : { places: [], note: r.note };
}

/** The kept pin, while it lasts until `until` (default now). */
export async function keptPin(
  db: Db,
  placeId: string,
  until: Date,
): Promise<GooglePin | null> {
  const row = unwrapMaybe(
    await db.from("google_pins").select("*").eq("google_place_id", placeId)
      .maybeSingle(),
    "google pin",
  );
  if (!row) return null;
  return new Date(row.fetched_at).getTime() + GOOGLE_COORDS_DAYS * DAY_MS >
      until.getTime()
    ? row as GooglePin
    : null;
}

/** One counted Place Details call; the answer kept for 30 days. */
export async function fetchPin(
  db: Db,
  settings: Settings,
  placeId: string,
  session: string | null | undefined,
  now: Date,
  fetchFn: Fetcher = fetch,
): Promise<{ pin: GooglePin } | { note: string }> {
  const key = serverKey();
  if (!googleUse(settings).places || !key) {
    return { note: "Google place search is not set up" };
  }
  const r = await guarded(
    db,
    "places_details",
    settings.google_caps,
    async () =>
      detailsResponse(
        await send(detailsRequest(placeId, key, session), fetchFn),
      ),
  );
  if (!r.ok) return { note: r.note };
  const pin: GooglePin = {
    google_place_id: placeId,
    ...r.value,
    fetched_at: now.toISOString(),
  };
  unwrap(
    await db.from("google_pins").upsert(pin, { onConflict: "google_place_id" }),
    "google pin",
  );
  return { pin };
}

/** The pin for a stop or a pick: the kept one when it lasts until `until`, else a new Details call. */
export async function googlePin(
  db: Db,
  settings: Settings,
  placeId: string,
  opts: { session?: string | null; until?: Date; now: Date },
  fetchFn: Fetcher = fetch,
): Promise<{ pin: GooglePin } | { note: string }> {
  const kept = await keptPin(db, placeId, opts.until ?? opts.now);
  if (kept) return { pin: kept };
  return await fetchPin(db, settings, placeId, opts.session, opts.now, fetchFn);
}

/** The end of a task's day (Colombo): a pin used for it must last until then. */
export function endOfDay(day: string): Date {
  return new Date(new Date(`${day}T00:00:00+05:30`).getTime() + DAY_MS);
}

/** Fetched again before the nightly clean-up when older than this and still to be driven. */
export const REFRESH_AFTER_DAYS = 23;
const LIVE_TASKS = ["assigned", "in_progress", "declined"];

/**
 * The nightly job (fleet-jobs google_content): the Google pins of stops and starts still to be driven
 * are fetched again once they are 23 days old (one counted Details call per place), so the clean-up
 * that follows never takes a pin a driver still needs; then every Google detail over 30 days old goes.
 */
export async function googleContentJob(
  db: Db,
  now: Date,
  fetchFn: Fetcher = fetch,
) {
  const settings = await loadSettings(db);
  const cut = new Date(now.getTime() - REFRESH_AFTER_DAYS * DAY_MS)
    .toISOString();
  const stops = unwrap(
    await db.from("task_stops").select(
      "id, google_place_id, tasks!inner(status)",
    )
      .lt("google_fetched_at", cut).in("status", ["pending", "arrived"]).in(
        "tasks.status",
        LIVE_TASKS,
      ),
    "google stops",
  );
  const starts = unwrap(
    await db.from("tasks").select("id, start_google_place_id").lt(
      "start_google_fetched_at",
      cut,
    ).in("status", ["assigned", "declined"]),
    "google starts",
  );
  const ids = new Set<string>([
    ...stops.map((s) => s.google_place_id).filter((x): x is string => !!x),
    ...starts.map((t) => t.start_google_place_id).filter((x): x is string =>
      !!x
    ),
  ]);
  let refreshed = 0;
  const notes = new Set<string>();
  for (const id of ids) {
    const got = await fetchPin(db, settings, id, null, now, fetchFn);
    if ("note" in got) {
      notes.add(got.note);
      continue;
    }
    refreshed += 1;
    const p = got.pin;
    // The trigger keeps an unchanged pin's marks as given, so the new fetch time is written with it.
    unwrap(
      await db.from("task_stops").update({
        lat: p.lat,
        lng: p.lng,
        google_fetched_at: p.fetched_at,
      })
        .eq("google_place_id", id).in(
          "id",
          stops.filter((s) => s.google_place_id === id).map((s) => s.id),
        ),
      "google stops",
    );
    unwrap(
      await db.from("tasks").update({
        start_lat: p.lat,
        start_lng: p.lng,
        start_google_fetched_at: p.fetched_at,
      })
        .eq("start_google_place_id", id).in(
          "id",
          starts.filter((t) => t.start_google_place_id === id).map((t) => t.id),
        ),
      "google starts",
    );
  }
  const pruned = unwrap(
    await db.rpc("prune_google_content", {}),
    "google prune",
  );
  return { places: ids.size, refreshed, notes: [...notes], pruned };
}
