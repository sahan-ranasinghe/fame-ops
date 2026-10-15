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
import { orsAutocomplete, PUBLIC_MIN_CHARS, type PublicPlace } from "../geocode.ts";
import { pastedPin } from "../pasted.ts";
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
  const exact = unwrap(await db.from("places").select("*").ilike("name", escapeLike(text)).order("created_at").limit(20), "places");
  if (exact.length > 0) {
    const rank = (p: Place) => (p.operator === "other" ? 0 : 2) + (p.kind === "office" ? 0 : 1);
    return [...exact].sort((a, b) => rank(a) - rank(b))[0];
  }
  const id = text.toUpperCase();
  if (/^[A-Z0-9-]{3,20}$/.test(id)) {
    const byId = unwrap(await db.from("places").select("*").or(`site_id.eq.${id},other_ids.cs.{${id}}`).limit(2), "places");
    if (byId.length === 1) return byId[0];
  }
  const town = unwrap(await db.from("towns").select("id").ilike("name", escapeLike(text)).limit(1), "towns");
  if (town.length > 0) return null;
  const partial = unwrap(
    await db.from("places").select("*").eq("operator", "other").neq("kind", "site").ilike("name", `%${escapeLike(text)}%`).limit(2),
    "places",
  );
  return partial.length === 1 ? partial[0] : null;
}

/** A place by its id, for a stop picked in the search box. */
export async function placeById(db: Db, id: string): Promise<Place> {
  const place = unwrapMaybe(await db.from("places").select("*").eq("id", id).maybeSingle(), "place");
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
  };
}

export const listPlaces = tool({
  name: "list_places",
  title: "List places",
  description: "Saved places (offices, stores, saved points) that tasks can use; the operators' sites (Dialog, Mobitel) only " +
    "with operator, kind site or a search. For a place field use search_places, which also finds sites by their ids.",
  readOnly: true,
  input: z.object({
    search: zText(80).optional().describe("Part of the name, the address or an id"),
    kind: z.enum(["office", "store", "site", "other"]).optional(),
    operator: z.enum(["dialog", "mobitel", "other"]).optional(),
    pinned: z.boolean().optional().describe("Only places with (true) or without (false) a pin"),
    limit: z.number().int().min(1).max(1000).optional().describe("Default 200"),
  }),
  async run({ search, kind, operator, pinned, limit = 200 }, { db }) {
    let q = db.from("places").select("*").order("name").limit(limit);
    if (kind) q = q.eq("kind", kind);
    if (operator) q = q.eq("operator", operator);
    if (!kind && !operator && !search) q = q.neq("kind", "site");
    if (pinned !== undefined) q = q.eq("pinned", pinned);
    const text = search?.replace(/[,()"\\]/g, " ").trim();
    if (text) {
      const like = `%${escapeLike(text)}%`;
      q = q.or(`name.ilike."${like}",address.ilike."${like}",ids_text.ilike."${like.toLowerCase()}"`);
    }
    const places = unwrap(await q, "places").map(placeCard);
    return { result: { count: places.length, places }, summary: `${places.length} places` };
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
    if ((lat === undefined) !== (lng === undefined)) throw new ToolError("Give both lat and lng, or neither.");
    const created = unwrap(
      await db.from("places")
        .insert({ name, address: address ?? null, lat: lat ?? null, lng: lng ?? null, kind: kind ?? "other", source: "claude", pin_source: lat !== undefined ? "manual" : null })
        .select("*").single(),
      "place",
    );
    return { result: { added: placeCard(created) }, summary: `added place ${created.name}` };
  },
});

// --- the search box -------------------------------------------------------------------------

export interface SearchResult {
  layer: "place" | "recent" | "map";
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
}

type RankedRow = { id: string; name: string; address: string | null; kind: string; operator: string; site_id: string | null; other_ids: string[]; district: string | null; depot: string | null; lat: number | null; lng: number | null };

function ourResult(p: RankedRow): SearchResult {
  const detail = [p.site_id, p.other_ids?.length ? p.other_ids.join(", ") : null, p.district, p.address].filter(Boolean).join(" · ");
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

const near = (a: { lat?: number; lng?: number }, b: { lat?: number; lng?: number }, metres: number) =>
  a.lat !== undefined && b.lat !== undefined && a.lng !== undefined && b.lng !== undefined &&
  Math.hypot((a.lat - b.lat) * 111320, (a.lng - b.lng) * 111320 * Math.cos((a.lat * Math.PI) / 180)) <= metres;

export const searchPlaces = tool({
  name: "search_places",
  title: "Find a place",
  description: "The location search behind every place field. Answers, in order: our places (offices, saved places and the " +
    "Dialog and Mobitel sites; an id such as MT0184 or a name; prefix matches first, then similar names), the places used in " +
    "tasks or requests in the last 90 days, then public places in Sri Lanka from the map search (from 3 characters; a daily " +
    "limit, after which map_note says so). Each result has a badge: Office, Site · Dialog, Site · Mobitel, Saved, Used before, " +
    "Map. A pasted \"lat, lng\" or Google Maps link (also a maps.app.goo.gl short link) answers `pin` instead. Use a place's " +
    "id as a stop's place_id; save a Map result or a pin with save_place first.",
  readOnly: true,
  input: z.object({
    text: zText(500).describe("What was typed or pasted: a name, a site id, \"lat, lng\" or a Google Maps link"),
    limit: z.number().int().min(1).max(20).optional().describe("Our places at most (default 8)"),
    map: z.boolean().optional().describe("Also ask the map search (default true)"),
  }),
  async run({ text, limit = 8, map = true }, { db, now }) {
    const typed = text.trim();
    const pin = await pastedPin(typed);
    if (pin) {
      return {
        result: { text: typed, results: [], pin: { ...pin, maps: mapsPoint(pin.lat, pin.lng) } },
        summary: `search: a pin at ${pin.lat.toFixed(5)}, ${pin.lng.toFixed(5)} (${pin.from})`,
      };
    }
    if (typed.length < SEARCH_MIN_CHARS) return { result: { text: typed, results: [] }, summary: "search: too short" };
    const since = new Date(now.getTime() - RECENT_DAYS * 86400000).toISOString();
    const [ourRes, recentRes, settings] = await Promise.all([
      db.rpc("search_places_ranked", { p_text: typed, p_limit: limit }),
      db.rpc("recent_places", { p_text: typed, p_since: since, p_limit: 5 }),
      loadSettings(db),
    ]);
    const ours = unwrap(ourRes, "places").map((p) => ourResult(p as RankedRow));
    const recent: SearchResult[] = unwrap(recentRes, "recent places").map((r) => ({
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
    if (map && typed.length >= PUBLIC_MIN_CHARS) {
      const base = await basePoint(db, settings);
      const found = await orsAutocomplete(typed, {
        db,
        key: Deno.env.get("ORS_KEY"),
        cap: settings.ors_autocomplete_daily_cap,
        focus: base?.point ? { lat: base.point.lat, lng: base.point.lng } : null,
        now,
      });
      mapNote = found.note;
      mapCached = found.cached;
      mapResults = found.places
        // A public place that is one of ours (same name, within 50 m) is not shown twice.
        .filter((m: PublicPlace) => !ours.some((o) => o.name.toLowerCase() === m.name.toLowerCase() && near(o, m, 50)))
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
      result: { text: typed, results, map_note: mapNote, map_cached: mapCached },
      summary: `search "${typed.slice(0, 40)}": ${ours.length} ours, ${recent.length} used before, ${mapResults.length} map${mapNote ? ` (${mapNote})` : ""}`,
    };
  },
});

export const savePlace = tool({
  name: "save_place",
  title: "Save a place from the search",
  description: "Saves a Map result or a pasted pin (after the pin is confirmed) as one of our places, kind other, with its " +
    "credit, so it is in our list next time. A place of the same name within 30 m is answered instead of a second one.",
  readOnly: false,
  input: z.object({
    name: zText(120),
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
    address: zText(240).optional(),
    from: z.enum(["map", "link", "pin"]).describe("map = a Map result (openrouteservice), link = a pasted Google Maps link, pin = typed or moved by hand"),
    ref: zText(200).optional().describe("The provider's id of a Map result"),
    attribution: zText(200).optional().describe("The credit of a Map result"),
  }),
  async run({ name, lat, lng, address, from, ref, attribution }, { db }) {
    const d = 0.0003; // about 33 m
    const same = unwrap(
      await db.from("places").select("*").ilike("name", escapeLike(name)).gte("lat", lat - d).lte("lat", lat + d).gte("lng", lng - d).lte("lng", lng + d).limit(1),
      "places",
    );
    if (same[0]) return { result: { place: detailCard(same[0]), existing: true }, summary: `save place: ${same[0].name} was already saved` };
    const source = from === "map" ? "ors" : from;
    const created = unwrap(
      await db.from("places").insert({
        name, address: address ?? null, lat, lng, kind: "other", source, pin_source: source,
        attribution: from === "map" ? (attribution ?? "© OpenStreetMap contributors · openrouteservice") : null, provider_ref: ref ?? null,
      }).select("*").single(),
      "place",
    );
    return { result: { place: detailCard(created), existing: false }, summary: `saved place ${created.name} (${source})` };
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
});

export const importPlaces = tool({
  name: "import_places",
  title: "Import sites",
  description: "Adds or updates the operators' sites, at most 500 rows a call, in one transaction: a row matches a place by " +
    "its site id (else, for Mobitel, by its coordinates at 4 decimals); a match gets the name, region, district, depot and the " +
    "other ids, and the pin when it had none or the pin came from the same preset (a pin set by hand is never replaced). " +
    "preset mobitel_ep attaches each id to the Mobitel place within 100 m, else adds a place. The web page's presets read the " +
    "operators' spreadsheets; Claude may send rows itself (preset claude).",
  readOnly: false,
  input: z.object({
    preset: z.enum(["dialog", "mobitel_4g", "mobitel_ep", "claude"]).optional().describe("Default claude"),
    rows: z.array(zSiteRow).min(1).max(500),
  }),
  async run({ preset = "claude", rows }, { db }) {
    const answer = unwrap(await db.rpc("import_place_rows", { p_rows: rows as unknown as never, p_preset: preset }), "import") as {
      added: number; updated: number; attached: number; unchanged: number; no_pin: number; skipped: { row: number; reason: string }[];
    };
    return {
      result: { preset, rows: rows.length, ...answer, skipped: answer.skipped.length ? answer.skipped : undefined },
      summary: `import ${preset}: ${rows.length} rows, ${answer.added} added, ${answer.updated} updated, ${answer.attached} attached, ${answer.unchanged} unchanged, ${answer.skipped.length} skipped`,
    };
  },
});

export const updatePlace = tool({
  name: "update_place",
  title: "Update a place",
  description: "Changes a place's name, address, kind, district or depot, sets or moves its pin (lat and lng together; a " +
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
  async run({ id, name, address, kind, district, depot, lat, lng, clear_pin }, { db }) {
    if ((lat === undefined) !== (lng === undefined)) throw new ToolError("Give both lat and lng, or neither.");
    if (clear_pin && lat !== undefined) throw new ToolError("Either move the pin or remove it, not both.");
    const before = await placeById(db, id);
    const patch: Update<"places"> = {};
    if (name !== undefined) patch.name = name;
    if (address !== undefined) patch.address = address;
    if (kind !== undefined) patch.kind = kind;
    if (district !== undefined) patch.district = district;
    if (depot !== undefined) patch.depot = depot;
    if (lat !== undefined && lng !== undefined) Object.assign(patch, { lat, lng, pin_source: "manual" });
    if (clear_pin) Object.assign(patch, { lat: null, lng: null, pin_source: null });
    if (Object.keys(patch).length === 0) return { result: { place: detailCard(before), changed: [] }, summary: `place ${before.name}: nothing to change` };
    const after = unwrap(await db.from("places").update(patch).eq("id", id).select("*").single(), "place");
    return { result: { place: detailCard(after), changed: Object.keys(patch).filter((k) => k !== "pin_source") }, summary: `updated place ${after.name}: ${Object.keys(patch).join(", ")}` };
  },
});

export const placeDetail = tool({
  name: "place_detail",
  title: "One place",
  description: "Everything about one place: the ids, region, district, depot, the pin and where it came from, the credit of a " +
    "place saved from the map search, and how often tasks used it in the last 90 days.",
  readOnly: true,
  input: z.object({ id: zId }),
  async run({ id }, { db, now }) {
    const place = await placeById(db, id);
    const since = new Date(now.getTime() - RECENT_DAYS * 86400000).toISOString();
    const used = await db.from("task_stops").select("id, tasks!inner(start_at)", { count: "exact", head: true }).eq("place_id", id).gte("tasks.start_at", since);
    return { result: { place: detailCard(place), stops_90_days: used.count ?? 0 }, summary: `place ${place.name}` };
  },
});
