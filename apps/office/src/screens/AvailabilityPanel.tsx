// "Who's available" (Phase 6): every driver for the day and time being
// planned, with a status chip (On duty since 07:12 · Off duty · On a task
// until ~10:40), what is next or what makes them busy, the day's counts and
// the licence; a click fills the driver select. Fetched 400 ms after the time
// settles and again every 60 s while open. On the decide page, the request
// form's "Assign now" and the task form.
import { useEffect, useState } from "react";
import { useFleet } from "../app/FleetContext";
import type { Availability, AvailableDriver } from "../data/types";
import { errText } from "../transport/errors";
import type { FleetError } from "../transport/types";
import { Loading, Notice, Pill } from "../ui/basics";
import { driverLine, driverTone, licenceTone } from "./availabilityLogic";

export const AVAILABILITY_REFRESH_MS = 60_000;
export const AVAILABILITY_SETTLE_MS = 400;

export function useAvailability(args: Record<string, unknown> | null): { data: Availability | null; err: string | null } {
  const { me, transport } = useFleet();
  const [data, setData] = useState<Availability | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const key = JSON.stringify(args);
  const allowed = me.tools.includes("availability");
  useEffect(() => {
    if (!args || !allowed) {
      setData(null);
      return;
    }
    let alive = true;
    const load = async () => {
      try {
        const p = await transport.call<Availability>("availability", args);
        if (!alive) return;
        setData(p);
        setErr(null);
      } catch (e) {
        if (alive) setErr(errText(e as FleetError)[0]);
      }
    };
    const timer = setTimeout(() => void load(), AVAILABILITY_SETTLE_MS);
    const every = setInterval(() => void load(), AVAILABILITY_REFRESH_MS);
    return () => { alive = false; clearTimeout(timer); clearInterval(every); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, allowed, transport]);
  return { data, err };
}

export function AvailabilityPanel({ args, picked, onPick, title = "Who's available" }: {
  /** availabilityArgs(...); null = the day and time are not known yet. */
  args: Record<string, unknown> | null;
  picked?: string;
  onPick?: (d: AvailableDriver) => void;
  title?: string;
}) {
  const { me } = useFleet();
  const { data, err } = useAvailability(args);
  if (!me.tools.includes("availability")) return null;
  return (
    <div className="card card-b form" data-testid="availability">
      <div className="section-t" style={{ marginBottom: 2 }}>{title}{data ? <span className="muted small" style={{ fontWeight: 400 }}> · {data.window.from}{data.window.until !== "end of the day" ? ` – ${data.window.until}` : ""} · {data.counts.free} of {data.counts.all} free</span> : null}</div>
      {!args && <p className="muted small" style={{ margin: 0 }}>Fill in the day and the time to see who is free then.</p>}
      {args && !data && !err && <Loading>Looking who is free…</Loading>}
      {err && <Notice tone="bad">{err}</Notice>}
      {data && (
        <div className="rows" role={onPick ? "listbox" : undefined} aria-label={onPick ? "Free drivers" : undefined}>
          {data.drivers.map((d) => {
            const Tag = onPick ? "button" : "div";
            return (
              <Tag
                key={d.username ?? d.name}
                type={onPick ? "button" : undefined}
                className={`row avail-row${picked && d.username === picked ? " picked" : ""}`}
                role={onPick ? "option" : undefined}
                aria-selected={onPick ? (picked ? d.username === picked : undefined) : undefined}
                onClick={onPick ? () => onPick(d) : undefined}
                data-testid="avail-row"
              >
                <span className="grow">
                  <span className="name">{d.name}{d.licence.chip === "red" || d.licence.chip === "orange" ? <> <Pill tone={licenceTone(d.licence.chip)}>licence {d.licence.chip === "red" ? "expired or due" : "expiring"}</Pill></> : null}</span>
                  <span className="sub" style={{ display: "block" }}>{driverLine(d)}</span>
                </span>
                <Pill tone={driverTone(d)}>{d.free ? (d.state === "off_duty" ? "Free · off duty" : "Free") : "Busy"}</Pill>
              </Tag>
            );
          })}
          {data.drivers.length === 0 && <p className="muted small" style={{ margin: 0 }}>No active drivers.</p>}
        </div>
      )}
    </div>
  );
}
