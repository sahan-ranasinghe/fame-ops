// Pieces the request pages share: the four vehicle groups and one vehicle as
// an option (the plate, what it is, how it stands, the custodian's links), and
// the requester's timeline.
import type { FieldChanges, RequestCard, SuggestedVehicle, Suggestions } from "../data/types";
import { joinDots } from "../lib/format";
import { diffLines, timelineSteps } from "./requestLogic";

export const GROUPS: [keyof NonNullable<Suggestions["groups"]>, string][] = [
  ["free_pool", "Free"],
  ["free_assigned", "Assigned to someone · ask first"],
  ["busy", "Busy"],
  ["in_garage", "In the garage"],
];

export function VehicleOption({ v, name, checked, disabled, onPick }: { v: SuggestedVehicle; name: string; checked: boolean; disabled?: boolean; onPick: () => void }) {
  const tone = v.pick === "no" ? "bad" : v.pick === "possible" ? "warn" : "";
  return (
    <label className="opt" style={disabled ? { opacity: 0.55 } : undefined}>
      <input type="radio" name={name} value={v.reg_no} checked={checked} disabled={disabled} onChange={onPick} />
      <span className="grow">
        <span className="plate">{v.reg_no}</span>
        <span className={`sub ${tone}`} style={{ display: "block", marginTop: 4 }}>{joinDots([v.make_model, v.seats ? `${v.seats} seats` : "", v.availability, v.but, v.back])}</span>
        {v.assigned_to && (
          <span className="sub" style={{ display: "block", marginTop: 4 }}>
            {joinDots([`Assigned to ${v.assigned_to}`, v.custodian_note, v.note])}
            {v.call && <> · <a href={v.call} onClick={(e) => e.stopPropagation()}>Call</a></>}
            {v.whatsapp && <> · <a href={v.whatsapp} target="_blank" rel="noopener" onClick={(e) => e.stopPropagation()}>WhatsApp</a></>}
          </span>
        )}
      </span>
    </label>
  );
}

/** The requester's timeline: sent → seen → approved → changed → decided again / cancelled (from the events). */
export function Timeline({ q }: { q: RequestCard }) {
  return (
    <ol className="rq-timeline" data-testid="request-timeline">
      {timelineSteps(q).map((s, i) => (
        <li key={`${s.label}-${i}`} className={s.done ? "done" : ""}>
          <i className={`dot ${s.done ? "ok" : "muted"}`} />
          <span>
            <b>{s.label}</b>
            {s.at ? <span className="sub" style={{ display: "block" }}>{s.at}</span> : null}
            {s.lines?.length ? <span className="sub" style={{ display: "block" }}>{s.lines.join(" · ")}</span> : null}
          </span>
        </li>
      ))}
    </ol>
  );
}

/** What changed, one line per field: "time Thu 15 Oct 09:00 → Thu 15 Oct 09:30". */
export function ChangesList({ changes, testId = "changes" }: { changes?: FieldChanges | null; testId?: string }) {
  const lines = diffLines(changes);
  if (lines.length === 0) return null;
  return (
    <ul className="changes" data-testid={testId}>
      {lines.map((l) => <li key={l}>{l}</li>)}
    </ul>
  );
}

/** The groups of free vehicles as radio options, or the flat list when the tool gave no groups. */
export function VehicleGroups({ sug, name, vehicle, onPick, greyGarage }: { sug: Suggestions; name: string; vehicle: string; onPick: (reg: string) => void; greyGarage?: boolean }) {
  if (!sug.groups) return <>{sug.vehicles.map((v) => <VehicleOption key={v.reg_no} v={v} name={name} checked={vehicle === v.reg_no} onPick={() => onPick(v.reg_no)} />)}</>;
  return (
    <>
      {GROUPS.map(([key, label]) => {
        const rows = sug.groups![key];
        if (rows.length === 0) return null;
        return (
          <div key={key} className="form" data-testid={`group-${key}`}>
            <div className="lab">{label}</div>
            {rows.map((v) => <VehicleOption key={v.reg_no} v={v} name={name} checked={vehicle === v.reg_no} disabled={greyGarage && key === "in_garage"} onPick={() => onPick(v.reg_no)} />)}
          </div>
        );
      })}
    </>
  );
}
