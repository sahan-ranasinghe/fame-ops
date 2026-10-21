// How long at a stop (21 October 2026: Google Calendar's duration; the app's components/patterns/DurationField.tsx, the
// same rules): one compact field, "Stay  1 h", the suggested stay in grey until one is chosen ("30 min · usual here");
// a click opens the sheet (a pop-over on a desktop): 5 min · 15 min · 30 min · 1 h · 2 h · 4 h · Custom, where Custom
// is an hours list and a minutes list (5 h is two clicks). Until the person picks, nothing is sent: the server uses the
// place's usual time or the type's default, which is what the field shows. Replaces the chip row and the minutes box.
import { useRef, useState } from "react";
import { Sheet } from "../ui/Sheet";
import { ChoiceChip } from "../ui/Select";
import { dwellText, parseDwell } from "./stopsLogic";

export interface DwellFallback {
  min: number;
  /**
   * place = the place's usual time ("usual here"); default = the type's default; either = not known yet (a request's
   * From and To: the usual time there when the place has one, else the default).
   */
  source: "place" | "default" | "either";
}

/** The presets (the app's STAY_PRESETS). */
export const STAY_PRESETS = [5, 15, 30, 60, 120, 240] as const;
const HOURS = Array.from({ length: 13 }, (_, i) => i);
const MINUTES = Array.from({ length: 12 }, (_, i) => i * 5);

const fallbackWords = (f: DwellFallback) =>
  f.source === "place" ? `${dwellText(f.min)} · usual here` : f.source === "default" ? `${dwellText(f.min)} · suggested` : `The usual time there, else ${dwellText(f.min)}`;

export function DwellPicker({ id, value, fallback, onChange, label = "Stay" }: {
  id: string;
  /** What the person chose (minutes or h:mm); "" = not chosen. */
  value: string;
  fallback: DwellFallback | null;
  onChange: (text: string) => void;
  label?: string;
}) {
  const parsed = parseDwell(value);
  const chosen = typeof parsed === "number" ? parsed : null;
  const [open, setOpen] = useState(false);
  const [custom, setCustom] = useState(false);
  const start = chosen ?? fallback?.min ?? 60;
  const [h, setH] = useState(0);
  const [m, setM] = useState(0);
  const btn = useRef<HTMLButtonElement>(null);
  const openSheet = () => {
    setH(Math.floor(start / 60));
    setM(start % 60 - ((start % 60) % 5));
    setCustom(chosen !== null && !(STAY_PRESETS as readonly number[]).includes(chosen));
    setOpen(true);
  };
  const pick = (v: string) => { onChange(v); setOpen(false); };
  return (
    <div className="field" data-testid="dwell-picker">
      <span className="lab" id={`${id}-l`}>{label}</span>
      <button ref={btn} id={id} type="button" className="stayfield" aria-labelledby={`${id}-l`} aria-haspopup="dialog" onClick={openSheet}>
        {chosen !== null ? <span>{dwellText(chosen)}</span> : <span className="muted" data-testid="dwell-fallback">{fallback ? fallbackWords(fallback) : "–"}</span>}
      </button>
      {parsed === "bad" && <span className="hint" style={{ color: "var(--bad)" }}>Pick how long, up to 12 h.</span>}
      {chosen !== null && fallback && (
        <span className="hint"><button type="button" className="linkish" onClick={() => onChange("")}>
          {fallback.source === "place" ? `Use the usual time here (${dwellText(fallback.min)})` : fallback.source === "default" ? `Use the suggestion (${dwellText(fallback.min)})` : "Use the usual time there"}
        </button></span>
      )}
      <Sheet open={open} onClose={() => setOpen(false)} title={label} anchor={btn} testId="stay-sheet"
        footer={(
          <>
            <button type="button" className="btn" onClick={() => pick("")}>Clear</button>
            {custom && <button type="button" className="btn primary" disabled={h * 60 + m === 0} onClick={() => pick(String(h * 60 + m))}>Done</button>}
          </>
        )}>
        <div className="chips" role="group" aria-label={`${label}: how long`}>
          {STAY_PRESETS.map((x) => (
            <ChoiceChip key={x} selected={!custom && chosen === x} onClick={() => pick(String(x))}>{dwellText(x)}</ChoiceChip>
          ))}
          <ChoiceChip selected={custom} onClick={() => setCustom(true)}>Custom</ChoiceChip>
        </div>
        {custom && (
          <div className="stay-wheels" data-testid="stay-wheels">
            <Wheel label="Hours" items={HOURS} value={h} onChange={setH} />
            <Wheel label="Minutes" items={MINUTES} value={m} onChange={setM} />
          </div>
        )}
      </Sheet>
    </div>
  );
}

/** One column of numbers: the chosen one marked; a click chooses. */
function Wheel({ label, items, value, onChange }: { label: string; items: number[]; value: number; onChange: (n: number) => void }) {
  return (
    <div className="stay-wheel">
      <span className="lab">{label}</span>
      <div role="radiogroup" aria-label={label} className="stay-wheel-list">
        {items.map((n) => (
          <button key={n} type="button" role="radio" aria-checked={n === value} aria-label={`${n} ${label.toLowerCase()}`} className={`mono${n === value ? " on" : ""}`} onClick={() => onChange(n)}>
            {String(n).padStart(2, "0")}
          </button>
        ))}
      </div>
    </div>
  );
}
