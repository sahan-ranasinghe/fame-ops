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
  /** Part 4b: a custom list may carry an address and a kind. */
  address?: string;
  kind?: "office" | "store" | "site" | "other";
}

export interface PresetResult {
  /** The built-in preset the rows came from ("dialog" for a custom mapping: the engine's own label is not used). */
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

export const PRESETS: Record<
  Preset,
  { label: string; operator: Operator; sheet: string; hint: string }
> = {
  dialog: {
    label: "Dialog site list",
    operator: "dialog",
    sheet: "All Operational Sites_DNS Data",
    hint:
      "Site ID, Other Site IDS, Site Name, New Region, District, Depot, Latitude, Longitude",
  },
  mobitel_4g: {
    label: "Mobitel 4G-LTE",
    operator: "mobitel",
    sheet: "4G-LTE",
    hint: "SiteName, Longitude, Latitude",
  },
  mobitel_ep: {
    label: "Mobitel EP list",
    operator: "mobitel",
    sheet: "EP Issue",
    hint: "Site ID, Lat. (N), Lon. (E)",
  },
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
  for (const [k, v] of Object.entries(row)) {
    if (k.toLowerCase().replace(/\s+/g, "") === want) return v;
  }
  return undefined;
}

/** A pin when both numbers parse and lie in Sri Lanka; swapped columns are put right (and said so). */
function pinOf(
  lat: unknown,
  lng: unknown,
): { lat: number; lng: number; note?: string } | null {
  const a = cellNumber(lat);
  const b = cellNumber(lng);
  if (a === null || b === null) return null;
  if (inLanka(a, b)) {
    const spaced = [lat, lng].some((v) =>
      typeof v === "string" && /\d\s+\d|\.\s+\d/.test(v.trim())
    );
    return spaced
      ? { lat: a, lng: b, note: "a space inside a coordinate removed" }
      : { lat: a, lng: b };
  }
  return inLanka(b, a)
    ? { lat: b, lng: a, note: "latitude and longitude were swapped" }
    : null;
}

/** Other site ids: split on , ; / and spaces, upper case, without the site's own id, no repeats. */
export function splitIds(v: unknown, own?: string): string[] {
  const ids = cellText(v).toUpperCase().split(/[,;/\s]+/).filter((x) =>
    x && x !== own && x !== "-" && x !== "NA" && x !== "N/A"
  );
  return [...new Set(ids)];
}

const round4 = (n: number) => Math.round(n * 1e4) / 1e4;

/**
 * A Mobitel SiteName: the code is the leading capitals and the first digit run (one capital after the digits
 * belongs to the code unless a lower-case letter follows it: "KYKAD3Kadugannawa8L" → KYKAD3); the name is the
 * words that follow, each with a trailing digit group (and one letter after it) stripped, up to the first word
 * that is then empty, has 3 characters or fewer, or still contains a digit. "_" counts as a space.
 */
export function parseMobitelName(
  raw: unknown,
): { code: string | null; name: string | null } {
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
  for (const [v, c] of counts) {
    if (c > n || (c === n && best !== null && v < best)) [best, n] = [v, c];
  }
  return best;
}

function result(
  preset: Preset,
  read: number,
  rows: SiteRow[],
  skipped: PresetResult["skipped"],
  repaired: PresetResult["repaired"] = [],
): PresetResult {
  const withPin = rows.filter((r) => r.lat !== undefined).length;
  return {
    preset,
    rows,
    read,
    with_pin: withPin,
    no_pin: rows.length - withPin,
    skipped,
    repaired,
  };
}

/** Dialog's operational site list: one row, one site (the built-in mapping on the engine below). */
export function dialogRows(cells: Cells[]): PresetResult {
  return {
    ...mapTable(objectsToTable(cells), BUILT_IN.dialog.mapping),
    preset: "dialog",
  };
}

/** Mobitel's 4G-LTE sector list: one place per coordinate at 4 decimals. */
export function mobitel4gRows(cells: Cells[]): PresetResult {
  const groups = new Map<
    string,
    {
      lat: number;
      lng: number;
      codes: (string | null)[];
      names: (string | null)[];
      first: number;
    }
  >();
  const skipped: PresetResult["skipped"] = [];
  const repaired: PresetResult["repaired"] = [];
  cells.forEach((c, i) => {
    const site = cellText(cell(c, "SiteName"));
    const pin = pinOf(cell(c, "Latitude"), cell(c, "Longitude"));
    if (!pin) {
      if (
        site || cellText(cell(c, "Latitude")) || cellText(cell(c, "Longitude"))
      ) skipped.push({ row: i + 2, reason: "no coordinates" });
      return;
    }
    if (pin.note) {
      repaired.push({ row: i + 2, note: `${site || "row"}: ${pin.note}` });
    }
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
  const claim = new Map<
    string,
    { size: number; place: (typeof ordered)[number] }
  >();
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
    const row: SiteRow = {
      operator: "mobitel",
      name: name ?? code ?? `Mobitel ${g.lat}, ${g.lng}`,
      lat: g.lat,
      lng: g.lng,
    };
    if (owns) row.site_id = code!;
    return row;
  });
  return result("mobitel_4g", cells.length, rows, skipped, repaired);
}

/** Mobitel's EP list: one id per row, attached on import to the Mobitel place within 100 m (the built-in mapping). */
export function mobitelEpRows(cells: Cells[]): PresetResult {
  return {
    ...mapTable(objectsToTable(cells), BUILT_IN.mobitel_ep.mapping),
    preset: "mobitel_ep",
  };
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

// --- the mapping engine (Part 4b): any sheet, any columns ----------------------------------

/** Our fields a column can be mapped to. */
export type Field =
  | "site_id"
  | "other_ids"
  | "name"
  | "lat"
  | "lng"
  | "latlng"
  | "district"
  | "region"
  | "depot"
  | "address"
  | "kind"
  | "operator";
export const FIELDS: { key: Field; label: string }[] = [
  { key: "name", label: "Name (required)" },
  { key: "site_id", label: "Site id" },
  { key: "other_ids", label: "Other ids" },
  { key: "lat", label: "Latitude" },
  { key: "lng", label: "Longitude" },
  { key: "latlng", label: '"lat, lng" in one column' },
  { key: "district", label: "District" },
  { key: "region", label: "Region" },
  { key: "depot", label: "Depot" },
  { key: "address", label: "Address" },
  { key: "kind", label: "Kind (office, store, site, other)" },
  { key: "operator", label: "Operator (Dialog, Mobitel)" },
];

/** How a sheet becomes places: which sheet, which row holds the column names, which column is which field. */
export interface Mapping {
  sheet?: string;
  /** The row with the column names, counted from 1. */
  header_row: number;
  /** Our field → the column's header text. */
  columns: Partial<Record<Field, string>>;
  /** The operator for every row when there is no operator column. */
  operator?: Operator;
  /** Every row must carry a site id (the operators' lists). */
  require_id?: boolean;
  /** Attach each id to a place of the same operator within this many metres, else add it (Mobitel EP). */
  attach_within_m?: number;
  /** Mobitel 4G: the name rule and one place per coordinate. */
  special?: "mobitel_4g";
}

/** The built-in presets: saved mappings on the same engine (Mobitel 4G keeps its name rule). */
export const BUILT_IN: Record<Preset, { name: string; mapping: Mapping }> = {
  dialog: {
    name: "Dialog site list",
    mapping: {
      sheet: "All Operational Sites_DNS Data",
      header_row: 1,
      operator: "dialog",
      require_id: true,
      columns: {
        site_id: "Site ID",
        other_ids: "Other Site IDS",
        name: "Site Name",
        region: "New Region",
        district: "District",
        depot: "Depot",
        lat: "Latitude",
        lng: "Longitude",
      },
    },
  },
  mobitel_4g: {
    name: "Mobitel 4G-LTE",
    mapping: {
      sheet: "4G-LTE",
      header_row: 1,
      operator: "mobitel",
      special: "mobitel_4g",
      columns: { name: "SiteName", lat: "Latitude", lng: "Longitude" },
    },
  },
  mobitel_ep: {
    name: "Mobitel EP list",
    mapping: {
      sheet: "EP Issue",
      header_row: 1,
      operator: "mobitel",
      require_id: true,
      attach_within_m: 100,
      columns: {
        site_id: "Site ID",
        name: "Site ID",
        lat: "Lat. (N)",
        lng: "Lon. (E)",
      },
    },
  },
};

/** Rows of objects (sheet_to_json's default) as a table: the header row first. */
export function objectsToTable(cells: Cells[]): unknown[][] {
  const header: string[] = [];
  for (const c of cells) {
    for (const k of Object.keys(c)) if (!header.includes(k)) header.push(k);
  }
  return [header, ...cells.map((c) => header.map((h) => c[h] ?? null))];
}

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, "");

/** The headers of a table at a row (counted from 1), as text. */
export function headersAt(table: unknown[][], headerRow: number): string[] {
  return (table[headerRow - 1] ?? []).map((v) => cellText(v));
}

/** The column index of a header (case and spaces forgiven), or -1. */
export function columnIndex(
  headers: string[],
  header: string | undefined,
): number {
  if (!header) return -1;
  const exact = headers.indexOf(header);
  return exact >= 0
    ? exact
    : headers.findIndex((h) => norm(h) === norm(header));
}

/** "Dialog", "dialog gsm", "MOBITEL" → the operator; anything else → other. */
export function operatorOf(v: unknown): Operator {
  const t = cellText(v).toLowerCase();
  if (t.includes("dialog")) return "dialog";
  if (t.includes("mobitel") || t.includes("slt")) return "mobitel";
  return "other";
}

/** "Office", "store", "Site" … → the kind, or null for anything else (the import then keeps "site"). */
export function kindOf(
  v: unknown,
): "office" | "store" | "site" | "other" | null {
  const t = cellText(v).toLowerCase();
  if (t === "office" || t === "head office" || t === "branch") return "office";
  if (t === "store" || t === "stores" || t === "warehouse") return "store";
  if (t === "site" || t === "tower" || t === "cell site") return "site";
  if (t === "other") return "other";
  return null;
}

/** "6.9271, 79.8612" (also with ; or a space). */
function pinText(v: unknown): [unknown, unknown] {
  const m = cellText(v).match(
    /^\s*(-?\d+(?:\.\d+)?)\s*[,;\s]\s*(-?\d+(?:\.\d+)?)\s*$/,
  );
  return m ? [m[1], m[2]] : [null, null];
}

/** What a mapping cannot work with, in words (no problem = []). */
export function mappingProblems(table: unknown[][], m: Mapping): string[] {
  const headers = headersAt(table, m.header_row);
  const out: string[] = [];
  if (!headers.some(Boolean)) {
    out.push(`Row ${m.header_row} has no column names.`);
  }
  if (!m.columns.name) out.push("Choose the column with the name.");
  for (const [field, header] of Object.entries(m.columns)) {
    if (header && columnIndex(headers, header) < 0) {
      out.push(`There is no column "${header}" (${field}).`);
    }
  }
  if ((m.columns.lat && !m.columns.lng) || (!m.columns.lat && m.columns.lng)) {
    out.push(
      'Choose both the latitude and the longitude column (or one "lat, lng" column).',
    );
  }
  if (m.columns.latlng && (m.columns.lat || m.columns.lng)) {
    out.push(
      'Use either the latitude and longitude columns or one "lat, lng" column, not both.',
    );
  }
  if (!m.operator && !m.columns.operator) {
    out.push("Choose the operator: a column, or one value for every row.");
  }
  if (m.require_id && !m.columns.site_id) {
    out.push("This list needs the site id column.");
  }
  if (m.attach_within_m && !m.columns.site_id) {
    out.push("Attaching ids needs the site id column.");
  }
  return out;
}

/**
 * A table (rows of cells, the header row among them) through a mapping: one place per row, problems reported
 * with the sheet's row number and skipped (never fatal): no name and no id, an id twice, a pin outside Sri
 * Lanka; swapped latitude and longitude and a space inside a number are repaired and said.
 */
export function mapTable(table: unknown[][], m: Mapping): PresetResult {
  const headers = headersAt(table, m.header_row);
  const col = (f: Field) => columnIndex(headers, m.columns[f]);
  const ix = Object.fromEntries(
    (FIELDS.map((f) => f.key)).map((f) => [f, col(f)]),
  ) as Record<Field, number>;
  const at = (
    row: unknown[],
    f: Field,
  ) => (ix[f] >= 0 ? row[ix[f]] : undefined);
  const body = table.slice(m.header_row);
  const firstRow = m.header_row + 1;
  if (m.special === "mobitel_4g") {
    const cells = body.map((row) => ({
      SiteName: at(row, "name"),
      Latitude: at(row, "lat"),
      Longitude: at(row, "lng"),
    }));
    const r = mobitel4gRows(cells);
    const shift = (n: number) => n - 2 + firstRow;
    return {
      ...r,
      skipped: r.skipped.map((s) => ({ ...s, row: shift(s.row) })),
      repaired: r.repaired.map((s) => ({ ...s, row: shift(s.row) })),
    };
  }
  const rows: SiteRow[] = [];
  const skipped: PresetResult["skipped"] = [];
  const repaired: PresetResult["repaired"] = [];
  const seen = new Set<string>();
  let read = 0;
  body.forEach((row, i) => {
    const n = firstRow + i;
    if (!Array.isArray(row) || row.every((v) => cellText(v) === "")) return;
    read += 1;
    const id = cellText(at(row, "site_id")).toUpperCase();
    const name = cellText(at(row, "name")) || id;
    const label = id || name || `row ${n}`;
    if (m.require_id && !id) {
      return void skipped.push({
        row: n,
        reason: `no ${m.columns.site_id ?? "site id"}`,
      });
    }
    if (!name) return void skipped.push({ row: n, reason: "no name" });
    if (id && seen.has(id)) {
      return void skipped.push({ row: n, reason: `${id} appears twice` });
    }
    if (id) seen.add(id);
    const [la, lo] = ix.latlng >= 0
      ? pinText(at(row, "latlng"))
      : [at(row, "lat"), at(row, "lng")];
    const hasNumbers = cellNumber(la) !== null && cellNumber(lo) !== null;
    const pin = pinOf(la, lo);
    if (hasNumbers && !pin) {
      return void skipped.push({
        row: n,
        reason: `${label}: outside Sri Lanka`,
      });
    }
    if (!pin && m.attach_within_m) {
      return void skipped.push({
        row: n,
        reason: `${label}: no usable coordinates`,
      });
    }
    const operator = m.columns.operator
      ? operatorOf(at(row, "operator"))
      : (m.operator ?? "other");
    const out: SiteRow = { operator, name };
    if (id) out.site_id = id;
    const others = splitIds(at(row, "other_ids"), id || undefined);
    if (ix.other_ids >= 0) out.other_ids = others;
    for (const f of ["district", "region", "depot", "address"] as const) {
      const v = cellText(at(row, f));
      if (v) out[f] = v;
    }
    const kind = ix.kind >= 0 ? kindOf(at(row, "kind")) : null;
    if (kind) out.kind = kind;
    if (pin) {
      out.lat = pin.lat;
      out.lng = pin.lng;
      if (pin.note) repaired.push({ row: n, note: `${label}: ${pin.note}` });
    }
    rows.push(out);
  });
  const withPin = rows.filter((r) => r.lat !== undefined).length;
  return {
    preset: "dialog",
    rows,
    read,
    with_pin: withPin,
    no_pin: rows.length - withPin,
    skipped,
    repaired,
  };
}
