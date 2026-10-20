// The filter pattern's rules (docs/ui-patterns.md §1), pure: a list's filters as definitions (single or multi choice
// with a default), the values chosen, how many are in use (the Filter button's badge), the chips under the search bar
// (each removable), Clear, and the sheet's draft that changes nothing until Apply.

export interface FilterOption {
  value: string;
  label: string;
  count?: number;
}

export interface FilterDef {
  key: string;
  label: string;
  kind: 'single' | 'multi';
  options: FilterOption[];
  /** single: the value when nothing is chosen ("all", "active"); multi: none ticked = all. */
  default?: string;
}

/** single: one value; multi: the values ticked. */
export type FilterValues = Record<string, string | string[]>;

export function defaultValues(defs: readonly FilterDef[]): FilterValues {
  const out: FilterValues = {};
  for (const d of defs) out[d.key] = d.kind === 'multi' ? [] : d.default ?? d.options[0]?.value ?? '';
  return out;
}

/** A filter is in use when it differs from its default. */
export function inUse(def: FilterDef, v: string | string[] | undefined): boolean {
  if (def.kind === 'multi') return Array.isArray(v) && v.length > 0;
  const dflt = def.default ?? def.options[0]?.value ?? '';
  return typeof v === 'string' && v !== '' && v !== dflt;
}

/** The Filter button's badge: how many filters are in use (a multi filter with three ticks counts once). */
export const activeCount = (defs: readonly FilterDef[], values: FilterValues): number => defs.filter((d) => inUse(d, values[d.key])).length;

/** The chips under the search bar: one per value in use, with what removing it leaves. */
export function activeChips(defs: readonly FilterDef[], values: FilterValues): { id: string; label: string; remove: FilterValues }[] {
  const chips: { id: string; label: string; remove: FilterValues }[] = [];
  for (const d of defs) {
    const v = values[d.key];
    if (!inUse(d, v)) continue;
    if (d.kind === 'multi') {
      for (const one of v as string[]) {
        const o = d.options.find((x) => x.value === one);
        chips.push({ id: `${d.key}:${one}`, label: o?.label ?? one, remove: { ...values, [d.key]: (v as string[]).filter((x) => x !== one) } });
      }
    } else {
      const o = d.options.find((x) => x.value === v);
      chips.push({ id: `${d.key}:${v}`, label: o?.label ?? String(v), remove: { ...values, [d.key]: d.default ?? d.options[0]?.value ?? '' } });
    }
  }
  return chips;
}

/** A tap in the sheet: a radio picks one; a tick box toggles. */
export function toggle(def: FilterDef, values: FilterValues, value: string): FilterValues {
  if (def.kind === 'single') return { ...values, [def.key]: value };
  const cur = (values[def.key] as string[] | undefined) ?? [];
  return { ...values, [def.key]: cur.includes(value) ? cur.filter((x) => x !== value) : [...cur, value] };
}

/** Clear: every filter back to its default (the search text is not a filter). */
export const clearValues = (defs: readonly FilterDef[]): FilterValues => defaultValues(defs);

/** Whether a value is chosen (the sheet's tick or radio). */
export function isChosen(def: FilterDef, values: FilterValues, value: string): boolean {
  const v = values[def.key];
  if (def.kind === 'multi') return Array.isArray(v) && v.includes(value);
  return (v === '' || v === undefined ? def.default ?? def.options[0]?.value : v) === value;
}

/** The single value of a filter (a radio), or its default. */
export const single = (defs: readonly FilterDef[], values: FilterValues, key: string): string => {
  const d = defs.find((x) => x.key === key);
  const v = values[key];
  return typeof v === 'string' && v !== '' ? v : d?.default ?? d?.options[0]?.value ?? '';
};

/** The ticked values of a multi filter. */
export const multi = (values: FilterValues, key: string): string[] => (Array.isArray(values[key]) ? (values[key] as string[]) : []);
