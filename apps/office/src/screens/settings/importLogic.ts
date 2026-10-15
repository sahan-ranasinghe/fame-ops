// The site import page's rules (Part 4b), pure so Vitest runs them: a first
// guess at the mapping from a sheet's column names, whether a mapping still is
// the chosen preset's, and the key the import records (an import replaces only
// pins from the same key).
import type { Field, Mapping } from "@fleet/sites";
import type { ImportPreset } from "../../data/types";

const GUESS: [Field, RegExp][] = [
  ["site_id", /^(site ?id|site ?code|code|id|site)$/i],
  ["other_ids", /other.*id/i],
  ["name", /^(site ?name|name|location|location ?name|place|place ?name)$/i],
  ["lat", /^(lat|latitude|lat\.? ?\(n\))$/i],
  ["lng", /^(lng|lon|long|longitude|lon\.? ?\(e\))$/i],
  ["latlng", /^(gps|coordinates|co-?ordinates|lat ?, ?lng|lat ?\/ ?lng|location ?pin|pin)$/i],
  ["district", /district/i],
  ["region", /^(new ?region|region)$/i],
  ["depot", /depot$/i],
  ["address", /address/i],
  ["kind", /^(kind|type|place ?type)$/i],
  ["operator", /^(operator|owner|network|company)$/i],
];

/** A first guess from the column names: each field takes the first column whose name looks like it. */
export function guessMapping(headers: string[], headerRow = 1): Mapping {
  const columns: Mapping["columns"] = {};
  const taken = new Set<string>();
  for (const [field, re] of GUESS) {
    const h = headers.find((x) => x && !taken.has(x) && re.test(x.trim()));
    if (h) {
      columns[field] = h;
      taken.add(h);
    }
  }
  // "Region" and "New Region" both there: the new one.
  const newRegion = headers.find((h) => /^new ?region$/i.test(h.trim()));
  if (newRegion) columns.region = newRegion;
  if (columns.lat && columns.lng) delete columns.latlng;
  const mapping: Mapping = { header_row: headerRow, columns };
  if (!columns.operator) mapping.operator = "other";
  return mapping;
}

const clean = (m: Mapping) => JSON.stringify({
  header_row: m.header_row, operator: m.operator ?? null, require_id: !!m.require_id, attach: m.attach_within_m ?? null, special: m.special ?? null,
  columns: Object.fromEntries(Object.entries(m.columns).filter(([, v]) => !!v).sort(([a], [b]) => a.localeCompare(b))),
});

/** The same mapping (the sheet aside: a file may name its sheet differently). */
export const sameMapping = (a: Mapping, b: Mapping) => clean(a) === clean(b);

/** The key the import records: the preset's own while its mapping is unchanged, else "custom". */
export function presetKeyFor(preset: ImportPreset | null, mapping: Mapping): { key: string; label: string } {
  if (preset && sameMapping(preset.mapping, mapping)) return { key: preset.key, label: preset.name };
  return { key: "custom", label: preset ? `${preset.name} (changed)` : "Custom mapping" };
}

/** The first problem rows to show, skipped and repaired together, by row number. */
export function problemRows(skipped: { row: number; reason: string }[], repaired: { row: number; note: string }[], limit = 20): { row: number; text: string; repaired: boolean }[] {
  return [...skipped.map((s) => ({ row: s.row, text: s.reason, repaired: false })), ...repaired.map((r) => ({ row: r.row, text: r.note, repaired: true }))]
    .sort((a, b) => a.row - b.row)
    .slice(0, limit);
}
