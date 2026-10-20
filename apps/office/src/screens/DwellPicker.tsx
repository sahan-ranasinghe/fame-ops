// "Time at this stop" (Phase 7, §17): always visible on every stop row. Quick
// picks 5 min, 15 min, 30 min, 1 h, 1 h 30, 2 h, and Other (minutes or h:mm,
// up to 12 h). Until the person picks, the first value is the place's usual
// time ("usual here") or the default for the type, and nothing is sent: the
// server uses the same.
import { useState } from "react";
import { DWELL_PICKS, dwellText, parseDwell } from "./stopsLogic";
import { ChoiceChip } from "../ui/Select";

export interface DwellFallback {
  min: number;
  /**
   * place = the place's usual time ("usual here"); default = the type's default; either = not known yet (a request's
   * From and To: the usual time there when the place has one, else the default).
   */
  source: "place" | "default" | "either";
}

const fallbackWords = (f: DwellFallback) =>
  f.source === "place" ? `${dwellText(f.min)} · usual here` : f.source === "default" ? `${dwellText(f.min)} · the default` : `The usual time there, else ${dwellText(f.min)}`;

const chipStyle = { minHeight: 40, padding: "6px 12px", fontSize: 14 } as const;

export function DwellPicker({ id, value, fallback, onChange, label = "Time at this stop" }: {
  id: string;
  /** What the person chose (minutes or h:mm); "" = not chosen. */
  value: string;
  fallback: DwellFallback | null;
  onChange: (text: string) => void;
  label?: string;
}) {
  const parsed = parseDwell(value);
  const chosen = typeof parsed === "number" ? parsed : null;
  const isPick = chosen !== null && (DWELL_PICKS as readonly number[]).includes(chosen);
  const [otherOpen, setOtherOpen] = useState(false);
  const showOther = otherOpen || (value.trim() !== "" && !isPick);
  const shown = chosen ?? (value.trim() === "" && fallback?.source !== "either" ? fallback?.min ?? null : null);
  return (
    <div className="field" data-testid="dwell-picker">
      <span className="lab" id={`${id}-l`}>{label}</span>
      <div className="chips" role="group" aria-labelledby={`${id}-l`}>
        {DWELL_PICKS.map((m) => (
          <ChoiceChip key={m} style={chipStyle} selected={!showOther && shown === m}
            onClick={() => { setOtherOpen(false); onChange(String(m)); }}>{dwellText(m)}</ChoiceChip>
        ))}
        <ChoiceChip style={chipStyle} selected={showOther} onClick={() => setOtherOpen(true)}>Other</ChoiceChip>
      </div>
      {showOther && (
        <input id={id} aria-label={`${label}: other`} placeholder="Minutes or h:mm, e.g. 45 or 2:30" inputMode="numeric" maxLength={5}
          value={value} onChange={(e) => onChange(e.target.value)} style={{ maxWidth: 240 }} />
      )}
      {parsed === "bad" ? (
        <span className="hint" style={{ color: "var(--bad)" }}>Minutes or h:mm, up to 12 h.</span>
      ) : value.trim() === "" && fallback ? (
        <span className="hint" data-testid="dwell-fallback">{fallbackWords(fallback)}</span>
      ) : chosen !== null && fallback ? (
        <span className="hint"><button type="button" className="linkish" onClick={() => { setOtherOpen(false); onChange(""); }}>
          {fallback.source === "place" ? `Use the usual time here (${dwellText(fallback.min)})` : fallback.source === "default" ? `Use the default (${dwellText(fallback.min)})` : "Use the usual time there"}
        </button></span>
      ) : null}
    </div>
  );
}
