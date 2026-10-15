// Places: offices, saved places and the operators' sites (Phase 6, Part 4), and
// the location search box behind every place field (a task's stops and start,
// a request's From and To) in three layers: our places, the places used in the
// last 90 days, then public places from the map search (geocode.ts). A pasted
// "lat, lng" or Google Maps link answers a pin instead (pasted.ts).

import { z } from "zod";
import type { Db, Row, Update } from "../db.ts";
import { ToolError, unwrap, unwrapMaybe } from "../db.ts";
import { basePoint } from "../eta.ts";
import { mapsPoint } from "../format.ts";
import {
  orsAutocomplete,
  PUBLIC_MIN_CHARS,
  type PublicPlace,
} from "../geocode.ts";
import { GOOGLE_ATTRIBUTION, googleUse } from "../google.ts";
import {
  GOOGLE_MIN_CHARS,
  googlePin,
  googleSuggestions,
} from "../googlePlaces.ts";
import { pastedPin } from "../pasted.ts";
import {
  BUILT_IN,
  type Field,
  FIELDS,
  type Mapping,
  type Preset,
} from "../sites.ts";
import { loadSettings } from "../settings.ts";
import { colomboDateTime } from "../time.ts";
import { tool, zId, zText } from "../tool.ts";

export type Place = Row<"places">;

/** Days a typed name counts as "used before". */
export const RECENT_DAYS = 90;
export const SEARCH_MIN_CHARS = 2;

const escapeLike = (s: string) => s.replace(/[\\%_]/g, "\\$&");

/**
 * The saved place a typed stop or start refers to, or null when it is just free text: the exact name (case
 * does not matter), else a site id or one of its other ids, else (when the text is not a town's name: a typed
 * "Galle" is the town, not "Galle Face Green") a name that only one of the office's own places contains. Sites
 * are never matched by part of their name: with thousands of them a town would turn into a tower.
 */
export async function findPlace(db: Db, typed: string): Promise<Place | null> {
  const text = typed.trim();
  if (text === "") return null;
  // Several places may share a name (sites): the office's own place first, then an office, then the oldest.
  const exact = unwrap(
    await db.from("places").select("*").eq("active", true).ilike(
      "name",
      escapeLike(text),
    ).order("created_at").limit(20),
    "places",
  );
  if (exact.length > 0) {
    const rank = (p: Place) =>
      (p.operator === "other" ? 0 : 2) + (p.kind === "office" ? 0 : 1);
    return [...exact].sort((a, b) => rank(a) - rank(b))[0];
  }
  const id = text.toUpperCase();
  if (/^[A-Z0-9-]{3,20}$/.test(id)) {
    const byId = unwrap(
      await db.from("places").select("*").eq("active", true).or(
        `site_id.eq.${id},other_ids.cs.{${id}}`,
      ).limit(2),
      "places",
    );
    if (byId.length === 1) return byId[0];
  }
  const town = unwrap(
    await db.from("towns").select("id").ilike("name", escapeLike(text)).limit(
      1,
    ),
    "towns",
  );
  if (town.length > 0) return null;
  const partial = unwrap(
    await db.from("places").select("*").eq("active", true).eq(
      "operator",
      "other",
    ).neq("kind", "site").ilike("name", `%${escapeLike(text)}%`).limit(2),
    "places",
  );
  return partial.length === 1 ? partial[0] : null;
}

/** A place by its id, for a stop picked in the search box. */
export async function placeById(db: Db, id: string): Promise<Place> {
  const place = unwrapMaybe(
    await db.from("places").select("*").eq("id", id).maybeSingle(),
    "place",
  );
  if (!place) throw new ToolError(`No place with id ${id}.`);
  return place;
}

/** The badge a place shows in the search box. */
export function badgeOf(p: { kind: string; operator?: string | null }): string {
  if (p.kind === "office") return "Office";
  if (p.operator === "dialog") return "Site · Dialog";
  if (p.operator === "mobitel") return "Site · Mobitel";
  if (p.kind === "site") return "Site";
  return "Saved";
}

/** The card list_places has always answered, with the Part 4 fields added. */
function placeCard(p: Place) {
  return {
    id: p.id,
    name: p.name,
    address: p.address,
    kind: p.kind,
    operator: p.operator !== "other" ? p.operator : undefined,
    site_id: p.site_id ?? undefined,
    district: p.district ?? undefined,
    pinned: p.lat != null,
    maps: p.lat != null && p.lng != null ? mapsPoint(p.lat, p.lng) : undefined,
  };
}

/** Everything about one place (place_detail, update_place). */
function detailCard(p: Place) {
  return {
    ...placeCard(p),
    badge: badgeOf(p),
    other_ids: p.other_ids?.length ? p.other_ids : undefined,
    region: p.region ?? undefined,
    depot: p.depot ?? undefined,
    lat: p.lat ?? undefined,
    lng: p.lng ?? undefined,
    source: p.source,
    pin_source: p.pin_source ?? undefined,
    attribution: p.attribution ?? undefined,
    imported_at: p.imported_at ? colomboDateTime(p.imported_at) : undefined,
    updated_at: colomboDateTime(p.updated_at),
    active: p.active ? undefined : false,
  };
}

export const listPlaces = tool({
  name: "list_places",
  title: "List places",
  description:
    "Saved places (offices, stores, saved points) that tasks can use; the operators' sites (Dialog, Mobitel) only " +
    "with operator, kind site or a search. For a place field use search_places, which also finds sites by their ids.",
  readOnly: true,
  input: z.object({
    search: zText(80).optional().describe(
      "Part of the name, the address or an id",
    ),
    kind: z.enum(["office", "store", "site", "other"]).optional(),
    operator: z.enum(["dialog", "mobitel", "other"]).optional(),
    pinned: z.boolean().optional().describe(
      "Only places with (true) or without (false) a pin",
    ),
    limit: z.number().int().min(1).max(1000).optional().describe("Default 200"),
  }),
  async run({ search, kind, operator, pinned, limit = 200 }, { db }) {
    let q = db.from("places").select("*").eq("active", true).order("name")
      .limit(limit);
    if (kind) q = q.eq("kind", kind);
    if (operator) q = q.eq("operator", operator);
    if (!kind && !operator && !search) q = q.neq("kind", "site");
    if (pinned !== undefined) q = q.eq("pinned", pinned);
    const text = search?.replace(/[,()"\\]/g, " ").trim();
    if (text) {
      const like = `%${escapeLike(text)}%`;
      q = q.or(
        `name.ilike."${like}",address.ilike."${like}",ids_text.ilike."${like.toLowerCase()}"`,
      );
    }
    const places = unwrap(await q, "places").map(placeCard);
    return {
      result: { count: places.length, places },
      summary: `${places.length} places`,
    };
  },
});

export const addPlace = tool({
  name: "add_place",
  title: "Add place",
  description:
    "Saves a place for pickups and drop-offs. With lat and lng the driver gets a map pin and a distance; without them the app navigates by address.",
  readOnly: false,
  input: z.object({
    name: zText(120).describe('e.g. "Head office, Colombo 05"'),
    address: zText(240).optional(),
    lat: z.number().min(-90).max(90).optional(),
    lng: z.number().min(-180).max(180).optional(),
    kind: z.enum(["office", "store", "site", "other"]).optional(),
  }),
  async run({ name, address, lat, lng, kind }, { db }) {
    if ((lat === undefined) !== (lng === undefined)) {
      throw new ToolError("Give both lat and lng, or neither.");
    }
    const created = unwrap(
      await db.from("places")
        .insert({
          name,
          address: address ?? null,
          lat: lat ?? null,
          lng: lng ?? null,
          kind: kind ?? "other",
          source: "claude",
          pin_source: lat !== undefined ? "manual" : null,
        })
        .select("*").single(),
      "place",
    );
    return {
      result: { added: placeCard(created) },
      summary: `added place ${created.name}`,
    };
  },
});

// --- the search box -------------------------------------------------------------------------

export interface SearchResult {
  /** google: a Google place search result (the google package): a google_place_id, no pin until google_place. */
  layer: "place" | "recent" | "map" | "google";
  badge: string;
  name: string;
  /** The second line: the site id and district, the address, the map's longer label. */
  detail?: string;
  id?: string;
  kind?: string;
  operator?: string;
  site_id?: string;
  pinned: boolean;
  lat?: number;
  lng?: number;
  /** recent: the last time it was used (Asia/Colombo). */
  last_used?: string;
  /** map: the provider's id and the credit to keep when it is saved. */
  ref?: string;
  attribution?: string;
  /** google: the place id (kept for good); its pin comes from google_place (kept 30 days). */
  google_place_id?: string;
}

type RankedRow = {
  id: string;
  name: string;
  address: string | null;
  kind: string;
  operator: string;
  site_id: string | null;
  other_ids: string[];
  district: string | null;
  depot: string | null;
  lat: number | null;
  lng: number | null;
};

function ourResult(p: RankedRow): SearchResult {
  const detail = [
    p.site_id,
    p.other_ids?.length ? p.other_ids.join(", ") : null,
    p.district,
    p.address,
  ].filter(Boolean).join(" · ");
  return {
    layer: "place",
    badge: badgeOf(p),
    name: p.name,
    detail: detail || undefined,
    id: p.id,
    kind: p.kind,
    operator: p.operator !== "other" ? p.operator : undefined,
    site_id: p.site_id ?? undefined,
    pinned: p.lat != null,
    lat: p.lat ?? undefined,
    lng: p.lng ?? undefined,
  };
}

const near = (
  a: { lat?: number; lng?: number },
  b: { lat?: number; lng?: number },
  metres: number,
) =>
  a.lat !== undefined && b.lat !== undefined && a.lng !== undefined &&
  b.lng !== undefined &&
  Math.hypot(
      (a.lat - b.lat) * 111320,
      (a.lng - b.lng) * 111320 * Math.cos((a.lat * Math.PI) / 180),
    ) <= metres;

export const searchPlaces = tool({
  name: "search_places",
  title: "Find a place",
  description:
    "The location search behind every place field. Answers, in order: our places (offices, saved places and the " +
    "Dialog and Mobitel sites; an id such as MT0184 or a name; prefix matches first, then similar names), the places used in " +
    "tasks or requests in the last 90 days, then public places in Sri Lanka from the map search (from 3 characters; a daily " +
    "limit, after which map_note says so). Each result has a badge: Office, Site · Dialog, Site · Mobitel, Saved, Used before, " +
    'Map. A pasted "lat, lng" or Google Maps link (also a maps.app.goo.gl short link) answers `pin` instead. Use a place\'s ' +
    "id as a stop's place_id; save a Map result or a pin with save_place first. With google (the google package), the map " +
    "layer is Google's place search instead (badge Google, credit Google Maps): a result has google_place_id and no pin; " +
    "google_place gives its pin, and a stop takes google_place_id with the name as place. Every Google request is counted; " +
    "at the cap the map layer is openrouteservice's again and map_note says why.",
  readOnly: true,
  input: z.object({
    text: zText(500).describe(
      'What was typed or pasted: a name, a site id, "lat, lng" or a Google Maps link',
    ),
    limit: z.number().int().min(1).max(20).optional().describe(
      "Our places at most (default 8)",
    ),
    map: z.boolean().optional().describe(
      "Also ask the map search (default true)",
    ),
    google: z.boolean().optional().describe(
      "The map layer from Google's place search when the google package is on (default false)",
    ),
    session: z.string().regex(
      /^[A-Za-z0-9_-]{8,36}$/,
      "a session token: 8 to 36 letters, digits, - or _",
    ).optional()
      .describe(
        "One token per typing session in one box, the same on the google_place call that ends it",
      ),
  }),
  async run(
    { text, limit = 8, map = true, google = false, session },
    { db, now },
  ) {
    const typed = text.trim();
    const pin = await pastedPin(typed);
    if (pin) {
      return {
        result: {
          text: typed,
          results: [],
          pin: { ...pin, maps: mapsPoint(pin.lat, pin.lng) },
        },
        summary: `search: a pin at ${pin.lat.toFixed(5)}, ${
          pin.lng.toFixed(5)
        } (${pin.from})`,
      };
    }
    if (typed.length < SEARCH_MIN_CHARS) {
      return {
        result: { text: typed, results: [] },
        summary: "search: too short",
      };
    }
    const since = new Date(now.getTime() - RECENT_DAYS * 86400000)
      .toISOString();
    const [ourRes, recentRes, settings] = await Promise.all([
      db.rpc("search_places_ranked", { p_text: typed, p_limit: limit }),
      db.rpc("recent_places", { p_text: typed, p_since: since, p_limit: 5 }),
      loadSettings(db),
    ]);
    const ours = unwrap(ourRes, "places").map((p) => ourResult(p as RankedRow));
    const recent: SearchResult[] = unwrap(recentRes, "recent places").map((
      r,
    ) => ({
      layer: "recent",
      badge: "Used before",
      name: r.name,
      detail: r.address ?? undefined,
      pinned: r.lat != null,
      lat: r.lat ?? undefined,
      lng: r.lng ?? undefined,
      last_used: colomboDateTime(r.last_used),
    }));
    let mapNote: string | undefined;
    let mapCached: boolean | undefined;
    let mapResults: SearchResult[] = [];
    let googleAsked = false;
    if (
      map && google && googleUse(settings).places &&
      typed.length >= GOOGLE_MIN_CHARS
    ) {
      googleAsked = true;
      const base = await basePoint(db, settings);
      const found = await googleSuggestions(db, settings, typed, {
        session,
        focus: base?.point ?? null,
      });
      mapNote = found.note;
      mapResults = found.places.map((g) => ({
        layer: "google" as const,
        badge: "Google",
        name: g.name,
        detail: g.secondary,
        pinned: false,
        google_place_id: g.place_id,
        attribution: GOOGLE_ATTRIBUTION,
      }));
    }
    // The open package's map search: always without google, and when Google refused or failed.
    if (map && typed.length >= PUBLIC_MIN_CHARS && (!googleAsked || mapNote)) {
      const base = await basePoint(db, settings);
      const found = await orsAutocomplete(typed, {
        db,
        key: Deno.env.get("ORS_KEY"),
        cap: settings.ors_autocomplete_daily_cap,
        perMinute: settings.ors_autocomplete_per_minute,
        focus: base?.point
          ? { lat: base.point.lat, lng: base.point.lng }
          : null,
        now,
      });
      mapNote = [mapNote, found.note].filter(Boolean).join(" · ") || undefined;
      mapCached = found.cached;
      mapResults = found.places
        // A public place that is one of ours (same name, within 50 m) is not shown twice.
        .filter((m: PublicPlace) =>
          !ours.some((o) =>
            o.name.toLowerCase() === m.name.toLowerCase() && near(o, m, 50)
          )
        )
        .map((m: PublicPlace) => ({
          layer: "map" as const,
          badge: "Map",
          name: m.name,
          detail: m.label !== m.name ? m.label : undefined,
          pinned: m.lat !== undefined,
          lat: m.lat,
          lng: m.lng,
          ref: m.ref,
          attribution: m.attribution,
        }));
    }
    const results = [...ours, ...recent, ...mapResults];
    return {
      result: {
        text: typed,
        results,
        map_note: mapNote,
        map_cached: mapCached,
      },
      summary: `search "${
        typed.slice(0, 40)
      }": ${ours.length} ours, ${recent.length} used before, ${mapResults.length} map${
        mapNote ? ` (${mapNote})` : ""
      }`,
    };
  },
});

export const googlePlace = tool({
  name: "google_place",
  title: "A Google place's pin",
  description:
    "The pin and address of a Google place search result (search_places with google): one Place Details call with the " +
    "Essentials fields only (location, address), counted before it is made, ending the typing session (pass its session). The " +
    "answer is kept 30 days by place id and is never saved as one of our places (Google's terms keep only the place id); a " +
    "stop takes google_place_id with the result's name as place. Refused at the cap: the note says so.",
  readOnly: false,
  input: z.object({
    google_place_id: zText(300),
    session: z.string().regex(
      /^[A-Za-z0-9_-]{8,36}$/,
      "a session token: 8 to 36 letters, digits, - or _",
    ).optional(),
  }),
  async run({ google_place_id, session }, { db, now }) {
    const settings = await loadSettings(db);
    const got = await googlePin(db, settings, google_place_id, {
      session,
      now,
    });
    if ("note" in got) {
      throw new ToolError(
        `${got.note}. Pick one of our places, paste a pin or type the address instead.`,
      );
    }
    const pin = got.pin;
    return {
      result: {
        google_place_id: pin.google_place_id,
        lat: pin.lat,
        lng: pin.lng,
        address: pin.address ?? undefined,
        short_address: pin.short_address ?? undefined,
        district: pin.district ?? undefined,
        fetched_at: colomboDateTime(pin.fetched_at),
        kept_until: colomboDateTime(
          new Date(new Date(pin.fetched_at).getTime() + 30 * 86400000)
            .toISOString(),
        ),
        attribution: GOOGLE_ATTRIBUTION,
        maps: mapsPoint(pin.lat, pin.lng),
      },
      summary: `google place ${google_place_id.slice(0, 40)}`,
    };
  },
});

export const saveArrivalPlace = tool({
  name: "save_arrival_place",
  title: "Save a reached Google stop as one of our places",
  description:
    "For a Google stop the driver reached (task_detail stops: google, arrival): saves one of our places at the driver's " +
    "own arrival point (where the phone was when the stop was reached), with a name the office types, never Google's name or " +
    "address. The stop then shows the saved place; next time it is found as one of ours.",
  readOnly: false,
  input: z.object({
    stop_id: zId,
    name: zText(120).describe("The office's own name for the place"),
    kind: z.enum(["office", "store", "site", "other"]).optional().describe(
      "Default other",
    ),
  }),
  async run({ stop_id, name, kind = "other" }, { db }) {
    const stop = unwrapMaybe(
      await db.from("task_stops").select(
        "id, place_name, address, google_place_id, arrival_lat, arrival_lng, saved_place_id",
      ).eq("id", stop_id).maybeSingle(),
      "stop",
    );
    if (!stop) throw new ToolError(`No stop with id ${stop_id}.`);
    if (stop.saved_place_id) {
      const saved = unwrapMaybe(
        await db.from("places").select("*").eq("id", stop.saved_place_id)
          .maybeSingle(),
        "place",
      );
      if (saved) {
        return {
          result: { place: detailCard(saved), existing: true },
          summary: `stop ${stop_id}: already saved as ${saved.name}`,
        };
      }
    }
    if (!stop.google_place_id) {
      throw new ToolError(
        "Only a Google stop is saved this way; save any other place with add_place or the search box.",
      );
    }
    if (stop.arrival_lat == null || stop.arrival_lng == null) {
      throw new ToolError(
        "The driver's arrival point is not known yet: the stop was not reached, or the phone's points have not come in.",
      );
    }
    const typed = name.trim();
    const google = [stop.place_name, stop.address].filter((x): x is string =>
      !!x
    ).map((x) => x.trim().toLowerCase());
    if (google.includes(typed.toLowerCase())) {
      throw new ToolError(
        "Type the office's own name for the place: Google's name and address cannot be kept.",
      );
    }
    const same = unwrap(
      await db.from("places").select("id, name").eq("active", true).eq(
        "operator",
        "other",
      ).ilike("name", escapeLike(typed)).limit(1),
      "places",
    );
    if (same[0]) {
      throw new ToolError(
        `A place named "${same[0].name}" already exists: pick another name.`,
      );
    }
    const created = unwrap(
      await db.from("places").insert({
        name: typed,
        kind,
        operator: "other",
        lat: stop.arrival_lat,
        lng: stop.arrival_lng,
        source: "arrival",
        pin_source: "arrival",
      }).select("*").single(),
      "place",
    );
    unwrap(
      await db.from("task_stops").update({ saved_place_id: created.id }).eq(
        "id",
        stop.id,
      ),
      "stop",
    );
    return {
      result: { place: detailCard(created), existing: false },
      summary: `saved place ${created.name} at the driver's arrival point`,
    };
  },
});

export const savePlace = tool({
  name: "save_place",
  title: "Save a place from the search",
  description:
    "Saves a Map result or a pasted pin (after the pin is confirmed) as one of our places, kind other, with its " +
    "credit, so it is in our list next time. A place of the same name within 30 m is answered instead of a second one.",
  readOnly: false,
  input: z.object({
    name: zText(120),
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
    address: zText(240).optional(),
    from: z.enum(["map", "link", "pin"]).describe(
      "map = a Map result (openrouteservice), link = a pasted Google Maps link, pin = typed or moved by hand",
    ),
    ref: zText(200).optional().describe("The provider's id of a Map result"),
    attribution: zText(200).optional().describe("The credit of a Map result"),
  }),
  async run({ name, lat, lng, address, from, ref, attribution }, { db }) {
    const d = 0.0003; // about 33 m
    const same = unwrap(
      await db.from("places").select("*").eq("active", true).ilike(
        "name",
        escapeLike(name),
      ).gte("lat", lat - d).lte("lat", lat + d).gte("lng", lng - d).lte(
        "lng",
        lng + d,
      ).limit(1),
      "places",
    );
    if (same[0]) {
      return {
        result: { place: detailCard(same[0]), existing: true },
        summary: `save place: ${same[0].name} was already saved`,
      };
    }
    const source = from === "map" ? "ors" : from;
    const created = unwrap(
      await db.from("places").insert({
        name,
        address: address ?? null,
        lat,
        lng,
        kind: "other",
        source,
        pin_source: source,
        attribution: from === "map"
          ? (attribution ?? "© OpenStreetMap contributors · openrouteservice")
          : null,
        provider_ref: ref ?? null,
      }).select("*").single(),
      "place",
    );
    return {
      result: { place: detailCard(created), existing: false },
      summary: `saved place ${created.name} (${source})`,
    };
  },
});

const zSiteRow = z.object({
  operator: z.enum(["dialog", "mobitel", "other"]),
  site_id: zText(40).optional(),
  other_ids: z.array(zText(40)).max(30).optional(),
  name: zText(160),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
  region: zText(80).optional(),
  district: zText(80).optional(),
  depot: zText(80).optional(),
  address: zText(240).optional(),
  kind: z.enum(["office", "store", "site", "other"]).optional(),
});

/** A preset key: a built-in one, "custom:<saved mapping id>", "custom" or "claude" (the pin rule compares it). */
const zPresetKey = z.string().trim().min(1).max(80).regex(
  /^[a-z0-9_:-]+$/,
  "a preset key: letters, digits, _ : -",
);

export const importPlaces = tool({
  name: "import_places",
  title: "Import sites",
  description:
    "Adds or updates places from a list, at most 500 rows a call, in one transaction: a row matches a place by " +
    "its operator and site id (else by its coordinates at 4 decimals, else by its name); a match gets the name, region, district, " +
    "depot, address, kind and the other ids, and the pin when it had none or the pin came from the same preset (a pin set by hand " +
    "is never replaced); a switched-off place matched again is switched on. preset mobitel_ep (or attach_within_m) attaches each " +
    "id to the same operator's place within that many metres, else adds a place. Every import is recorded (who, when, the file, " +
    "the counts): the first call answers import_id, pass it with the next batches of the same file; undo_place_import takes it back.",
  readOnly: false,
  input: z.object({
    preset: zPresetKey.optional().describe(
      "dialog, mobitel_4g, mobitel_ep, custom:<id> (a saved mapping), custom or claude (default)",
    ),
    rows: z.array(zSiteRow).min(1).max(500),
    import_id: zId.optional().describe(
      "The import this batch belongs to (from the first batch's answer)",
    ),
    file_name: zText(200).optional().describe(
      "The file the rows came from (recorded with the first batch)",
    ),
    preset_label: zText(120).optional().describe(
      "The preset's name as people read it",
    ),
    attach_within_m: z.number().int().min(1).max(1000).optional().describe(
      "Attach each id to a place within this many metres",
    ),
  }),
  async run(
    {
      preset = "claude",
      rows,
      import_id,
      file_name,
      preset_label,
      attach_within_m,
    },
    { db, actor },
  ) {
    let importId = import_id;
    if (importId) {
      const known = unwrapMaybe(
        await db.from("place_imports").select("id, undone_at").eq(
          "id",
          importId,
        ).maybeSingle(),
        "import",
      );
      if (!known) throw new ToolError(`No import with id ${importId}.`);
      if (known.undone_at) {
        throw new ToolError("That import was undone: start a new one.");
      }
    } else {
      const made = unwrap(
        await db.from("place_imports").insert({
          by_employee_id: actor.employeeId ?? null,
          by_name: actor.name,
          file_name: file_name ?? null,
          preset_key: preset,
          preset_label: preset_label ?? null,
        }).select("id").single(),
        "import",
      );
      importId = made.id;
    }
    const answer = unwrap(
      await db.rpc("import_place_rows", {
        p_rows: rows as unknown as never,
        p_preset: preset,
        p_import_id: importId,
        p_attach_m: attach_within_m ?? undefined,
      }),
      "import",
    ) as {
      added: number;
      updated: number;
      attached: number;
      unchanged: number;
      no_pin: number;
      skipped: { row: number; reason: string }[];
    };
    return {
      result: {
        import_id: importId,
        preset,
        rows: rows.length,
        ...answer,
        skipped: answer.skipped.length ? answer.skipped : undefined,
      },
      summary:
        `import ${preset}: ${rows.length} rows, ${answer.added} added, ${answer.updated} updated, ${answer.attached} attached, ${answer.unchanged} unchanged, ${answer.skipped.length} skipped`,
    };
  },
});

function importCard(i: Row<"place_imports">) {
  return {
    id: i.id,
    at: colomboDateTime(i.at),
    by: i.by_name,
    file: i.file_name ?? undefined,
    preset: i.preset_label ?? i.preset_key,
    rows: i.rows,
    added: i.added,
    updated: i.updated,
    attached: i.attached || undefined,
    unchanged: i.unchanged || undefined,
    no_pin: i.no_pin || undefined,
    skipped: i.skipped || undefined,
    undone: i.undone_at
      ? {
        at: colomboDateTime(i.undone_at),
        by: i.undone_by ?? undefined,
        ...(i.undo_result as Record<string, unknown> ?? {}),
      }
      : undefined,
  };
}

export const listPlaceImports = tool({
  name: "list_place_imports",
  title: "Site imports",
  description:
    "The site imports, newest first: who, when, the file, the preset, the counts, and whether and when one was undone.",
  readOnly: true,
  input: z.object({
    limit: z.number().int().min(1).max(100).optional().describe("Default 20"),
  }),
  async run({ limit = 20 }, { db }) {
    const rows = unwrap(
      await db.from("place_imports").select("*").order("at", {
        ascending: false,
      }).limit(limit),
      "imports",
    );
    return {
      result: { imports: rows.map(importCard) },
      summary: `${rows.length} imports`,
    };
  },
});

export const undoPlaceImport = tool({
  name: "undo_place_import",
  title: "Undo a site import",
  description:
    "Takes an import back: the places it added are switched off (kept for the stops that used them, left out of every " +
    "search), the places it updated or attached ids to are put back as they were. A place changed since the import (by hand or by " +
    "a later import) is left as it is and named. Nothing is deleted. Once per import.",
  readOnly: false,
  input: z.object({ import_id: zId }),
  async run({ import_id }, { db, actor }) {
    const answer = unwrap(
      await db.rpc("undo_place_import", {
        p_import_id: import_id,
        p_by: actor.name,
      }),
      "undo",
    ) as {
      switched_off: number;
      restored: number;
      left_as_is: number;
      left_names: string[];
    };
    return {
      result: {
        import_id,
        ...answer,
        left_names: answer.left_names.length ? answer.left_names : undefined,
      },
      summary: `undo import ${
        import_id.slice(0, 8)
      }: ${answer.switched_off} switched off, ${answer.restored} restored, ${answer.left_as_is} left as they were`,
    };
  },
});

const zMapping = z.object({
  sheet: zText(120).optional(),
  header_row: z.number().int().min(1).max(100),
  columns: z.object(
    Object.fromEntries(
      FIELDS.map((f) => [f.key, zText(120).optional()]),
    ) as Record<Field, z.ZodOptional<z.ZodString>>,
  )
    .refine((c) => !!c.name, "the name column is needed"),
  operator: z.enum(["dialog", "mobitel", "other"]).optional(),
  require_id: z.boolean().optional(),
  attach_within_m: z.number().int().min(1).max(1000).optional(),
});

export const listImportPresets = tool({
  name: "list_import_presets",
  title: "Site import presets",
  description:
    "The presets the site import offers: the built-in ones (Dialog site list, Mobitel 4G-LTE with its name rule, " +
    "Mobitel EP list attaching within 100 m) and the mappings saved by name, each with its sheet, header row and columns.",
  readOnly: true,
  input: z.object({}),
  async run(_input, { db }) {
    const saved = unwrap(
      await db.from("site_import_presets").select("*").order("name"),
      "presets",
    );
    const presets = [
      ...(Object.keys(BUILT_IN) as Preset[]).map((key) => ({
        key,
        name: BUILT_IN[key].name,
        built_in: true,
        mapping: BUILT_IN[key].mapping,
      })),
      ...saved.map((p) => ({
        key: `custom:${p.id}`,
        id: p.id,
        name: p.name,
        built_in: false,
        mapping: p.mapping as unknown as Mapping,
        saved_by: p.updated_by ?? p.created_by,
        saved_at: colomboDateTime(p.updated_at),
      })),
    ];
    return { result: { presets }, summary: `${presets.length} import presets` };
  },
});

export const saveImportPreset = tool({
  name: "save_import_preset",
  title: "Save a site import mapping",
  description:
    "Saves a column mapping under a name (saving again under the same name replaces it), so the next file of that " +
    "kind is imported with one choice. The built-in presets keep their names.",
  readOnly: false,
  input: z.object({ name: zText(80), mapping: zMapping }),
  async run({ name, mapping }, { db, actor }) {
    if (
      (Object.keys(BUILT_IN) as Preset[]).some((k) =>
        BUILT_IN[k].name.toLowerCase() === name.trim().toLowerCase()
      )
    ) {
      throw new ToolError(
        `"${name}" is a built-in preset: choose another name.`,
      );
    }
    const existing = unwrapMaybe(
      await db.from("site_import_presets").select("id").ilike(
        "name",
        escapeLike(name.trim()),
      ).maybeSingle(),
      "preset",
    );
    const saved = existing
      ? unwrap(
        await db.from("site_import_presets").update({
          mapping: mapping as unknown as never,
          updated_by: actor.name,
          updated_at: new Date().toISOString(),
        }).eq("id", existing.id).select("*").single(),
        "preset",
      )
      : unwrap(
        await db.from("site_import_presets").insert({
          name: name.trim(),
          mapping: mapping as unknown as never,
          created_by: actor.name,
          updated_by: actor.name,
        }).select("*").single(),
        "preset",
      );
    return {
      result: {
        key: `custom:${saved.id}`,
        id: saved.id,
        name: saved.name,
        replaced: !!existing,
      },
      summary: `${existing ? "replaced" : "saved"} import preset ${saved.name}`,
    };
  },
});

export const updatePlace = tool({
  name: "update_place",
  title: "Update a place",
  description:
    "Changes a place's name, address, kind, district or depot, sets or moves its pin (lat and lng together; a " +
    "pin set here is never replaced by an import), or removes the pin (clear_pin).",
  readOnly: false,
  input: z.object({
    id: zId,
    name: zText(160).optional(),
    address: zText(240).optional(),
    kind: z.enum(["office", "store", "site", "other"]).optional(),
    district: zText(80).optional(),
    depot: zText(80).optional(),
    lat: z.number().min(-90).max(90).optional(),
    lng: z.number().min(-180).max(180).optional(),
    clear_pin: z.boolean().optional(),
  }),
  async run(
    { id, name, address, kind, district, depot, lat, lng, clear_pin },
    { db },
  ) {
    if ((lat === undefined) !== (lng === undefined)) {
      throw new ToolError("Give both lat and lng, or neither.");
    }
    if (clear_pin && lat !== undefined) {
      throw new ToolError("Either move the pin or remove it, not both.");
    }
    const before = await placeById(db, id);
    const patch: Update<"places"> = {};
    if (name !== undefined) patch.name = name;
    if (address !== undefined) patch.address = address;
    if (kind !== undefined) patch.kind = kind;
    if (district !== undefined) patch.district = district;
    if (depot !== undefined) patch.depot = depot;
    if (lat !== undefined && lng !== undefined) {
      Object.assign(patch, { lat, lng, pin_source: "manual" });
    }
    if (clear_pin) {
      Object.assign(patch, { lat: null, lng: null, pin_source: null });
    }
    if (Object.keys(patch).length === 0) {
      return {
        result: { place: detailCard(before), changed: [] },
        summary: `place ${before.name}: nothing to change`,
      };
    }
    const after = unwrap(
      await db.from("places").update(patch).eq("id", id).select("*").single(),
      "place",
    );
    return {
      result: {
        place: detailCard(after),
        changed: Object.keys(patch).filter((k) => k !== "pin_source"),
      },
      summary: `updated place ${after.name}: ${Object.keys(patch).join(", ")}`,
    };
  },
});

export const placeDetail = tool({
  name: "place_detail",
  title: "One place",
  description:
    "Everything about one place: the ids, region, district, depot, the pin and where it came from, the credit of a " +
    "place saved from the map search, and how often tasks used it in the last 90 days.",
  readOnly: true,
  input: z.object({ id: zId }),
  async run({ id }, { db, now }) {
    const place = await placeById(db, id);
    const since = new Date(now.getTime() - RECENT_DAYS * 86400000)
      .toISOString();
    const used = await db.from("task_stops").select(
      "id, tasks!inner(start_at)",
      { count: "exact", head: true },
    ).eq("place_id", id).gte("tasks.start_at", since);
    return {
      result: { place: detailCard(place), stops_90_days: used.count ?? 0 },
      summary: `place ${place.name}`,
    };
  },
});
