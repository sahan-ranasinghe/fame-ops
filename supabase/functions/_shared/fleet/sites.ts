// Site lists (Phase 6, Part 4, docs/phase6-plan.md 8): the three presets that
// turn a spreadsheet's rows into places to import. Pure: the web reads the file
// with SheetJS (sheet_to_json, the header row as keys) and hands the rows here
// (imported as @fleet/sites); import_places applies the upsert rules of 8.3 in
// the database (import_place_rows). Deno tests: sites_test.ts.
//
//   dialog       "All Operational Sites_DNS Data": one row = one site (Site ID,
//                Other Site IDS, Site Name, New Region, District, Depot,
//                Latitude, Longitude); a pin only when both coordinates lie in
//                Sri Lanka.
//   mobitel_4g   "4G-LTE": SiteName + Longitude/Latitude, one row per sector;
//                rows without a coordinate pair are skipped; one place per
//                coordinate at 4 decimals, the most frequent code and name of its
//                rows ("AMARA1 Aranthalawa 89L Am NOA" → AMARA1 · Aranthalawa).
//   mobitel_ep   "EP Issue": Site ID + Lat. (N) / Lon. (E); the import attaches
//                each id to the Mobitel place within 100 m (else a new place).

export type Operator = "dialog" | "mobitel" | "other";
export type Preset = "dialog" | "mobitel_4g" | "mobitel_ep";

/** One place to import (import_places' row). */
export interface SiteRow {
  operator: Operator;
  site_id?: string;
  other_ids?: string[];
  name: string;
  lat?: number;
  lng?: number;
  region?: string;
  district?: string;
  depot?: string;
}

export interface PresetResult {
  preset: Preset;
  rows: SiteRow[];
  /** Spreadsheet rows read (header excluded, empty rows included). */
  read: number;
  with_pin: number;
  no_pin: number;
  /** Rows left out, with the reason (row = the spreadsheet's row number, the header being row 1). */
  skipped: { row: number; reason: string }[];
  /** Rows taken after a repair: latitude and longitude swapped, a space inside a number. */
  repaired: { row: number; note: string }[];
}

export const PRESETS: Record<Preset, { label: string; operator: Operator; sheet: string; hint: string }> = {
  dialog: { label: "Dialog site list", operator: "dialog", sheet: "All Operational Sites_DNS Data", hint: "Site ID, Other Site IDS, Site Name, New Region, District, Depot, Latitude, Longitude" },
  mobitel_4g: { label: "Mobitel 4G-LTE", operator: "mobitel", sheet: "4G-LTE", hint: "SiteName, Longitude, Latitude" },
  mobitel_ep: { label: "Mobitel EP list", operator: "mobitel", sheet: "EP Issue", hint: "Site ID, Lat. (N), Lon. (E)" },
};

type Cells = Record<string, unknown>;

/** Sri Lanka, generously: 5–10 °N, 79–82 °E. */
export function inLanka(lat: number, lng: number): boolean {
  return lat >= 5 && lat <= 10 && lng >= 79 && lng <= 82;
}

/** A number from a cell ("7.9272", 7.9272, " 7.9 ", "9. 680384"); "#N/A", "", text → null. */
export function cellNumber(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v !== "string") return null;
  const t = v.replace(/\s+/g, "");
  if (!/^-?\d+(\.\d+)?$/.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/** Trimmed text with single spaces, or "" for an empty cell. */
export function cellText(v: unknown): string {
  if (v === null || v === undefined) return "";
  return String(v).replace(/\s+/g, " ").trim();
}

/** A cell by its header, forgiving case and spaces ("Other Site IDS", "other site ids "). */
function cell(row: Cells, header: string): unknown {
  if (header in row) return row[header];
  const want = header.toLowerCase().replace(/\s+/g, "");
  for (const [k, v] of Object.entries(row)) if (k.toLowerCase().replace(/\s+/g, "") === want) return v;
  return undefined;
}

/** A pin when both numbers parse and lie in Sri Lanka; swapped columns are put right (and said so). */
function pinOf(lat: unknown, lng: unknown): { lat: number; lng: number; note?: string } | null {
  const a = cellNumber(lat);
  const b = cellNumber(lng);
  if (a === null || b === null) return null;
  if (inLanka(a, b)) {
    const spaced = [lat, lng].some((v) => typeof v === "string" && /\d\s+\d|\.\s+\d/.test(v.trim()));
    return spaced ? { lat: a, lng: b, note: "a space inside a coordinate removed" } : { lat: a, lng: b };
  }
  return inLanka(b, a) ? { lat: b, lng: a, note: "latitude and longitude were swapped" } : null;
}

/** Other site ids: split on , ; / and spaces, upper case, without the site's own id, no repeats. */
export function splitIds(v: unknown, own?: string): string[] {
  const ids = cellText(v).toUpperCase().split(/[,;/\s]+/).filter((x) => x && x !== own && x !== "-" && x !== "NA" && x !== "N/A");
  return [...new Set(ids)];
}

const round4 = (n: number) => Math.round(n * 1e4) / 1e4;

/**
 * A Mobitel SiteName: the code is the leading capitals and the first digit run (one capital after the digits
 * belongs to the code unless a lower-case letter follows it: "KYKAD3Kadugannawa8L" → KYKAD3); the name is the
 * words that follow, each with a trailing digit group (and one letter after it) stripped, up to the first word
 * that is then empty, has 3 characters or fewer, or still contains a digit. "_" counts as a space.
 */
export function parseMobitelName(raw: unknown): { code: string | null; name: string | null } {
  const tokens = cellText(raw).replace(/_/g, " ").split(" ").filter(Boolean);
  if (tokens.length === 0) return { code: null, name: null };
  let code: string | null = null;
  const words: string[] = [...tokens];
  const m = words[0].match(/^([A-Z]{2,6}\d+(?:[A-Z](?![a-z]))?)(.*)$/);
  if (m) {
    code = m[1];
    words[0] = m[2];
    if (words[0] === "") words.shift();
  }
  const name: string[] = [];
  for (const w of words) {
    const stripped = w.replace(/\d+[A-Za-z]?$/, "");
    if (stripped.length <= 3 || /\d/.test(stripped)) break;
    name.push(stripped);
  }
  return { code, name: name.length ? name.join(" ") : null };
}

function mostFrequent(values: (string | null)[]): string | null {
  const counts = new Map<string, number>();
  for (const v of values) if (v) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best: string | null = null;
  let n = 0;
  for (const [v, c] of counts) if (c > n || (c === n && best !== null && v < best)) [best, n] = [v, c];
  return best;
}

function result(preset: Preset, read: number, rows: SiteRow[], skipped: PresetResult["skipped"], repaired: PresetResult["repaired"] = []): PresetResult {
  const withPin = rows.filter((r) => r.lat !== undefined).length;
  return { preset, rows, read, with_pin: withPin, no_pin: rows.length - withPin, skipped, repaired };
}

/** Dialog's operational site list: one row, one site. */
export function dialogRows(cells: Cells[]): PresetResult {
  const rows: SiteRow[] = [];
  const skipped: PresetResult["skipped"] = [];
  const repaired: PresetResult["repaired"] = [];
  const seen = new Set<string>();
  cells.forEach((c, i) => {
    const id = cellText(cell(c, "Site ID")).toUpperCase();
    const name = cellText(cell(c, "Site Name"));
    if (!id && !name) return; // an empty row
    if (!id) return void skipped.push({ row: i + 2, reason: "no Site ID" });
    if (seen.has(id)) return void skipped.push({ row: i + 2, reason: `${id} appears twice` });
    seen.add(id);
    const pin = pinOf(cell(c, "Latitude"), cell(c, "Longitude"));
    const row: SiteRow = { operator: "dialog", site_id: id, other_ids: splitIds(cell(c, "Other Site IDS"), id), name: name || id };
    const region = cellText(cell(c, "New Region")) || cellText(cell(c, "Region"));
    const district = cellText(cell(c, "District"));
    const depot = cellText(cell(c, "Depot"));
    if (region) row.region = region;
    if (district) row.district = district;
    if (depot) row.depot = depot;
    if (pin) {
      row.lat = pin.lat;
      row.lng = pin.lng;
      if (pin.note) repaired.push({ row: i + 2, note: `${id}: ${pin.note}` });
    }
    rows.push(row);
  });
  return result("dialog", cells.length, rows, skipped, repaired);
}

/** Mobitel's 4G-LTE sector list: one place per coordinate at 4 decimals. */
export function mobitel4gRows(cells: Cells[]): PresetResult {
  const groups = new Map<string, { lat: number; lng: number; codes: (string | null)[]; names: (string | null)[]; first: number }>();
  const skipped: PresetResult["skipped"] = [];
  const repaired: PresetResult["repaired"] = [];
  cells.forEach((c, i) => {
    const site = cellText(cell(c, "SiteName"));
    const pin = pinOf(cell(c, "Latitude"), cell(c, "Longitude"));
    if (!pin) {
      if (site || cellText(cell(c, "Latitude")) || cellText(cell(c, "Longitude"))) skipped.push({ row: i + 2, reason: "no coordinates" });
      return;
    }
    if (pin.note) repaired.push({ row: i + 2, note: `${site || "row"}: ${pin.note}` });
    const lat = round4(pin.lat);
    const lng = round4(pin.lng);
    const key = `${lat},${lng}`;
    const { code, name } = parseMobitelName(site);
    const g = groups.get(key) ?? { lat, lng, codes: [], names: [], first: i };
    g.codes.push(code);
    g.names.push(name);
    groups.set(key, g);
  });
  // A code belongs to one place: the place with the most rows carrying it keeps it, another place keyed by its coordinates.
  const ordered = [...groups.values()].sort((a, b) => a.first - b.first);
  const claim = new Map<string, { size: number; place: (typeof ordered)[number] }>();
  for (const g of ordered) {
    const code = mostFrequent(g.codes);
    if (!code) continue;
    const size = g.codes.filter((x) => x === code).length;
    const held = claim.get(code);
    if (!held || size > held.size) claim.set(code, { size, place: g });
  }
  const rows: SiteRow[] = ordered.map((g) => {
    const code = mostFrequent(g.codes);
    const owns = code !== null && claim.get(code)?.place === g;
    const name = mostFrequent(g.names);
    const row: SiteRow = { operator: "mobitel", name: name ?? code ?? `Mobitel ${g.lat}, ${g.lng}`, lat: g.lat, lng: g.lng };
    if (owns) row.site_id = code!;
    return row;
  });
  return result("mobitel_4g", cells.length, rows, skipped, repaired);
}

/** Mobitel's EP list: one id per row, attached on import to the Mobitel place within 100 m. */
export function mobitelEpRows(cells: Cells[]): PresetResult {
  const rows: SiteRow[] = [];
  const skipped: PresetResult["skipped"] = [];
  const repaired: PresetResult["repaired"] = [];
  const seen = new Set<string>();
  cells.forEach((c, i) => {
    const id = cellText(cell(c, "Site ID")).toUpperCase();
    if (!id) return;
    if (seen.has(id)) return void skipped.push({ row: i + 2, reason: `${id} appears twice` });
    seen.add(id);
    const pin = pinOf(cell(c, "Lat. (N)"), cell(c, "Lon. (E)"));
    if (!pin) return void skipped.push({ row: i + 2, reason: `${id}: no usable coordinates` });
    if (pin.note) repaired.push({ row: i + 2, note: `${id}: ${pin.note}` });
    rows.push({ operator: "mobitel", site_id: id, name: id, lat: pin.lat, lng: pin.lng });
  });
  return result("mobitel_ep", cells.length, rows, skipped, repaired);
}

export function presetRows(preset: Preset, cells: Cells[]): PresetResult {
  switch (preset) {
    case "dialog":
      return dialogRows(cells);
    case "mobitel_4g":
      return mobitel4gRows(cells);
    case "mobitel_ep":
      return mobitelEpRows(cells);
  }
}
