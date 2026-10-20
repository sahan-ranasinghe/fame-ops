// The filters' rules (docs/ui-patterns.md §1), pure: a list's filters as definitions (a section of radio choices or of
// tick boxes, each with its default), read from and written to the URL (the default leaves no trace; several ticked
// values are one comma-separated parameter), the filters in use (the Filter button's count and the removable chips), and
// the panel's draft (nothing changes until Apply). FilterBar.tsx draws them.

export interface FilterOption {
  value: string;
  label: string;
  /** The server's count beside the choice ("Open · 5"), when it gives one. */
  count?: number;
}

export interface FilterDef {
  /** The URL parameter, and the key in the values. */
  key: string;
  /** The section's heading and the chip's prefix ("Vehicle: WP CAB-4521"). */
  label: string;
  /** One of (radio choices) or several (tick boxes). */
  kind: "single" | "multi";
  options: FilterOption[];
  /** The value when nothing is chosen: a single filter's "all" choice, a multi filter's none ([]). */
  default?: string | string[];
  /**
   * Any value in the URL counts even when it is not (yet) a choice: a vehicle or driver from a link while the list of
   * vehicles is still loading. Otherwise a value that is not a choice falls back to the default.
   */
  open?: boolean;
}

export type FilterValue = string | string[];
export type FilterValues = Record<string, FilterValue>;

const asList = (v: FilterValue | undefined): string[] => (Array.isArray(v) ? v : v ? [v] : []);

/** A filter's default value. */
export function defaultOf(def: FilterDef): FilterValue {
  if (def.kind === "multi") return asList(def.default as FilterValue | undefined);
  return typeof def.default === "string" ? def.default : "";
}

/** The values when nothing is chosen. */
export function defaultsOf(defs: readonly FilterDef[]): FilterValues {
  return Object.fromEntries(defs.map((d) => [d.key, defaultOf(d)]));
}

const sameList = (a: string[], b: string[]) => a.length === b.length && [...a].sort().join("\u0000") === [...b].sort().join("\u0000");

/** Is this value the filter's default (not "in use")? */
export function isDefault(def: FilterDef, v: FilterValue | undefined): boolean {
  const d = defaultOf(def);
  if (def.kind === "multi") return sameList(asList(v), d as string[]);
  return (typeof v === "string" ? v : "") === d;
}

const allowed = (def: FilterDef, v: string) => def.open || def.options.some((o) => o.value === v);

/** The values in the URL; a missing or unknown one is the default. */
export function readFilters(params: Pick<URLSearchParams, "get">, defs: readonly FilterDef[]): FilterValues {
  const out: FilterValues = {};
  for (const def of defs) {
    const raw = params.get(def.key);
    if (def.kind === "multi") {
      const picked = raw ? raw.split(",").map((s) => s.trim()).filter((s) => s && allowed(def, s)) : [];
      out[def.key] = raw === null || (raw !== "" && !picked.length) ? defaultOf(def) : [...new Set(picked)];
    } else {
      out[def.key] = raw !== null && raw !== "" && allowed(def, raw) ? raw : defaultOf(def);
    }
  }
  return out;
}

/** The URL after Apply: every filter's parameter set or, at its default, removed; the other parameters kept. */
export function writeFilters(params: URLSearchParams, defs: readonly FilterDef[], values: FilterValues): URLSearchParams {
  const out = new URLSearchParams(params);
  for (const def of defs) {
    const v = values[def.key];
    if (v === undefined || isDefault(def, v)) {
      // A multi filter whose default is not empty, emptied: say so with an empty parameter (else it reads as the default).
      if (def.kind === "multi" && v !== undefined && !asList(v).length && asList(defaultOf(def)).length) out.set(def.key, "");
      else out.delete(def.key);
    } else out.set(def.key, def.kind === "multi" ? asList(v).join(",") : (v as string));
  }
  return out;
}

/** One chip of a filter in use. */
export interface ActiveChip {
  key: string;
  /** The ticked value this chip stands for (a multi filter has one chip per value). */
  value: string;
  /** "Vehicle: WP CAB-4521". */
  text: string;
}

const labelOf = (def: FilterDef, v: string) => def.options.find((o) => o.value === v)?.label ?? v;

/** The filters in use, as chips, in the definitions' order. */
export function activeChips(defs: readonly FilterDef[], values: FilterValues): ActiveChip[] {
  const out: ActiveChip[] = [];
  for (const def of defs) {
    const v = values[def.key];
    if (v === undefined || isDefault(def, v)) continue;
    if (def.kind === "multi") for (const x of asList(v)) out.push({ key: def.key, value: x, text: `${def.label}: ${labelOf(def, x)}` });
    else out.push({ key: def.key, value: v as string, text: `${def.label}: ${labelOf(def, v as string)}` });
  }
  return out;
}

/** The number on the Filter button: the filters in use (a multi filter counts once). */
export function activeCount(defs: readonly FilterDef[], values: FilterValues): number {
  return defs.filter((d) => values[d.key] !== undefined && !isDefault(d, values[d.key])).length;
}

/** The values with one chip removed: a single filter back to its default, a multi filter without that value. */
export function removeChip(defs: readonly FilterDef[], values: FilterValues, chip: Pick<ActiveChip, "key" | "value">): FilterValues {
  const def = defs.find((d) => d.key === chip.key);
  if (!def) return values;
  if (def.kind === "multi") return { ...values, [def.key]: asList(values[def.key]).filter((x) => x !== chip.value) };
  return { ...values, [def.key]: defaultOf(def) };
}

/** The panel's draft after a tick or a radio press. */
export function toggleChoice(def: FilterDef, current: FilterValue | undefined, value: string): FilterValue {
  if (def.kind === "single") return value;
  const list = asList(current);
  return list.includes(value) ? list.filter((x) => x !== value) : [...list, value];
}

/** Is this choice on in the draft? */
export const isChosen = (def: FilterDef, current: FilterValue | undefined, value: string): boolean =>
  def.kind === "multi" ? asList(current).includes(value) : (typeof current === "string" ? current : defaultOf(def)) === value;

/** A choice's text in the panel: "Open · 5" when a count is given. */
export const choiceText = (o: FilterOption): string => (o.count != null ? `${o.label} · ${o.count}` : o.label);

/** The choices of a long section narrowed by what is typed in it (a fleet of vehicles, the drivers). */
export function narrowChoices(options: readonly FilterOption[], text: string): FilterOption[] {
  const t = text.trim().toLowerCase();
  if (!t) return [...options];
  const squash = (s: string) => s.toLowerCase().replace(/[\s-]/g, "");
  return options.filter((o) => o.label.toLowerCase().includes(t) || squash(o.label).includes(squash(t)) || o.value.toLowerCase().includes(t));
}

/** A section with this many choices or more gets a box to narrow them. */
export const NARROW_FROM = 10;

/**
 * A "pick one of a list" filter with an "All …" first (vehicles, drivers): the value from a link is kept as a choice
 * even before the list has loaded (or when it is no longer in it).
 */
export function listDef(key: string, label: string, allLabel: string, options: readonly FilterOption[], current?: string): FilterDef {
  const opts = [...options];
  if (current && !opts.some((o) => o.value === current)) opts.unshift({ value: current, label: current });
  return { key, label, kind: "single", options: [{ value: "", label: allLabel }, ...opts], default: "", open: true };
}

/** A single filter from the pages' [value, label] pairs (their option lists), with counts when given. */
export function pairsDef(key: string, label: string, pairs: readonly (readonly [string, string])[], def: string, counts?: Partial<Record<string, number>>): FilterDef {
  return { key, label, kind: "single", default: def, options: pairs.map(([value, l]) => ({ value, label: l, count: counts?.[value] })) };
}
