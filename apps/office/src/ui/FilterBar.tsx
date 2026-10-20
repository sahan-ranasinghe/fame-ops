// The filters of a list (docs/ui-patterns.md §1): the search box, ONE Filter button with a count badge (the filters in
// use), Sort as its own small menu ("Sort: Newest ▾"), and the filters in use as removable chips under them ("Clear all"
// from two). The button opens FilterPanel: a popover under it on a desktop, a bottom sheet on a phone (ui/Sheet.tsx);
// sections of radio choices or tick boxes with the server's counts beside them; nothing changes until Apply; Clear empties
// the draft; Esc or a click outside closes it without applying. The values live in the URL (useUrlFilters, or the page's
// own reading when its parameters are older than this), so a link or a reload shows the same list. The rules are in
// filterLogic.ts. No rows of filter chips across the top of a list.
import { type ReactNode, type RefObject, useId, useRef, useState } from "react";
import { useLocation, useSearchParams } from "react-router";
import {
  activeChips,
  activeCount,
  choiceText,
  defaultsOf,
  type FilterDef,
  type FilterValues,
  isChosen,
  NARROW_FROM,
  narrowChoices,
  readFilters,
  removeChip,
  toggleChoice,
  writeFilters,
} from "./filterLogic";
import { Icon } from "./icons";
import { leftPage } from "./ListKit";
import { Sheet } from "./Sheet";

export interface SortChoice {
  value: string;
  label: string;
}

/** The filters in the URL: read with the definitions, written on Apply (the defaults leave no trace). */
export function useUrlFilters(defs: readonly FilterDef[]): { values: FilterValues; apply: (values: FilterValues) => void } {
  const [params, setParams] = useSearchParams();
  const { pathname } = useLocation();
  const values = readFilters(params, defs);
  return {
    values,
    apply: (next) => {
      // A write after the page was left would land on the next page's address (Hotfix 4).
      if (leftPage(pathname)) return;
      setParams((old) => writeFilters(old, defs, next), { replace: true });
    },
  };
}

/** One section of the panel: radio choices or tick boxes, a box to narrow a long list. */
function Section({ def, value, onChange }: { def: FilterDef; value: FilterValues[string] | undefined; onChange: (v: FilterValues[string]) => void }) {
  const name = useId();
  const [narrow, setNarrow] = useState("");
  const long = def.options.length >= NARROW_FROM;
  const shown = long ? narrowChoices(def.options, narrow) : def.options;
  return (
    <fieldset className="fsec" data-testid={`filter-section-${def.key}`}>
      <legend>{def.label}</legend>
      {long && (
        <input type="search" className="fsec-narrow" aria-label={`Find a ${def.label.toLowerCase()}`} placeholder={`Find a ${def.label.toLowerCase()}`}
          value={narrow} onChange={(e) => setNarrow(e.target.value)} />
      )}
      <div className="fsec-opts">
        {shown.map((o) => (
          <label key={o.value || "(all)"} className="fopt">
            <input
              type={def.kind === "multi" ? "checkbox" : "radio"}
              name={name}
              checked={isChosen(def, value, o.value)}
              onChange={() => onChange(toggleChoice(def, value, o.value))}
            />
            <span>{choiceText(o)}</span>
          </label>
        ))}
        {!shown.length && <span className="muted small">No {def.label.toLowerCase()} matches “{narrow}”.</span>}
      </div>
    </fieldset>
  );
}

/** The panel itself (the Filter button opens it): sections, Clear and Apply. */
export function FilterPanel({ open, onClose, defs, values, onApply, anchor, title = "Filters" }: {
  open: boolean;
  onClose: () => void;
  defs: readonly FilterDef[];
  values: FilterValues;
  onApply: (values: FilterValues) => void;
  anchor?: RefObject<HTMLElement | null>;
  title?: string;
}) {
  const [draft, setDraft] = useState<FilterValues>(values);
  const [wasOpen, setWasOpen] = useState(false);
  // Each opening starts from the values in use (reset while rendering: no flash of the last draft).
  if (open && !wasOpen) {
    setWasOpen(true);
    setDraft(values);
  }
  if (!open && wasOpen) setWasOpen(false);
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={title}
      anchor={anchor}
      width={360}
      testId="filter-panel"
      footer={(
        <>
          <button type="button" className="btn" onClick={() => setDraft(defaultsOf(defs))} data-testid="filter-clear">Clear</button>
          <button type="button" className="btn primary" onClick={() => { onApply(draft); onClose(); }} data-testid="filter-apply">Apply</button>
        </>
      )}
    >
      <div className="fsecs">
        {defs.map((d) => <Section key={d.key} def={d} value={draft[d.key]} onChange={(v) => setDraft((x) => ({ ...x, [d.key]: v }))} />)}
      </div>
    </Sheet>
  );
}

/** Sort as its own small menu beside the Filter button: "Sort: Newest ▾". */
export function SortMenu({ value, options, onChange, label = "Sort" }: { value: string; options: readonly SortChoice[]; onChange: (v: string) => void; label?: string }) {
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const current = options.find((o) => o.value === value)?.label ?? value;
  return (
    <>
      <button ref={btn} type="button" className="btn sort-btn" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen((o) => !o)} data-testid="sort-button">
        <span className="muted">{label}:</span> {current} <Icon name="down" />
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title={label} anchor={btn} width={260} quietTitle testId="sort-menu">
        <div className="sort-list" role="radiogroup" aria-label={label}>
          {options.map((o) => (
            <button key={o.value} type="button" role="radio" aria-checked={o.value === value} className="sort-opt"
              onClick={() => { if (o.value !== value) onChange(o.value); setOpen(false); }}>{o.label}</button>
          ))}
        </div>
      </Sheet>
    </>
  );
}

/**
 * The bar above a list. `search` is the page's search box (ListKit's or listLocal's), `filters` + `values` + `onChange`
 * the Filter button, its panel and the chips, `sort` the Sort menu, `extra` anything else that belongs on the row (a view
 * switch, a toggle that is not a filter).
 */
export function FilterBar({ search, filters = [], values = {}, onChange, sort, extra, title }: {
  search?: ReactNode;
  filters?: readonly FilterDef[];
  values?: FilterValues;
  onChange?: (values: FilterValues) => void;
  sort?: { value: string; options: readonly SortChoice[]; onChange: (v: string) => void; label?: string };
  extra?: ReactNode;
  title?: string;
}) {
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const n = activeCount(filters, values);
  const chips = activeChips(filters, values);
  const apply = (v: FilterValues) => onChange?.(v);
  return (
    <div className="filter-bar" data-testid="filter-bar">
      <div className="filter-row">
        {search}
        {filters.length > 0 && (
          <button ref={btn} type="button" className={`btn filter-btn${n ? " on" : ""}`} aria-haspopup="dialog" aria-expanded={open}
            onClick={() => setOpen((o) => !o)} data-testid="filter-button">
            <Icon name="filter" />Filter{n > 0 && <span className="badge" aria-label={`${n} in use`}>{n}</span>}
          </button>
        )}
        {sort && <SortMenu {...sort} />}
        {extra}
      </div>
      {chips.length > 0 && (
        <div className="filter-chips" role="list" aria-label="Filters in use" data-testid="filter-chips">
          {chips.map((c) => (
            <span key={`${c.key}:${c.value}`} role="listitem" className="fchip">
              {c.text}
              <button type="button" aria-label={`Remove ${c.text}`} onClick={() => apply(removeChip(filters, values, c))}><Icon name="close" /></button>
            </span>
          ))}
          {chips.length >= 2 && <button type="button" className="linkish fchip-clear" onClick={() => apply(defaultsOf(filters))}>Clear all</button>}
        </div>
      )}
      {filters.length > 0 && <FilterPanel open={open} onClose={() => setOpen(false)} defs={filters} values={values} onApply={apply} anchor={btn} title={title} />}
    </div>
  );
}
