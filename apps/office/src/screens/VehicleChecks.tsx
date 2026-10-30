// Round 4–7, feature 4 (phase8-plan.md §33.1): the vehicle checks as the office reads them (Samsara / Motive's DVIR list:
// each vehicle's latest inspection, then its history). The vehicle page: "Today's check" (list_vehicles' check_today: All
// good / Problem: Damage, at 07:42 by Kamal; "No check today") and the last 7 days (vehicle_checks: the day, the time, who,
// the result, the odometer, how; a problem opens its issue; the photos as thumbnails when the answer has them, for the
// vehicles or issues permission). A notification's link (/vehicles/<plate>?check=<id>) scrolls to that check and marks it.
// A task: its check lines ("Vehicle check 07:42 · All good" / "· Problem: Damage" with the photos).
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { useFleet } from "../app/FleetContext";
import type { CheckToday, IssuesList, VehicleCheck, VehicleChecks } from "../data/types";
import { useQuery } from "../data/useQuery";
import { dayWords } from "../lib/when";
import { errText } from "../transport/errors";
import type { FleetError } from "../transport/types";
import { Notice, Pill } from "../ui/basics";
import { colomboDay } from "../ui/dateRange";
import { EmptyLine, SkeletonRows } from "../ui/ListKit";
import { byDay, checkTone, lastWeekArgs, SIDE_TEXT, taskCheckLine } from "./myTripLogic";
import { DeleteEntryButton } from "./bin/BinParts";

/** The photos of a check as small thumbnails, each opening large in a new tab. */
export function CheckPhotos({ photos }: { photos?: VehicleCheck["photos"] }) {
  if (!photos?.length) return null;
  return (
    <div className="photos" data-testid="check-photos">
      {photos.map((p, n) => {
        const label = p.side ? SIDE_TEXT[p.side] : `Photo ${n + 1}`;
        return (
          <a key={p.url} href={p.url} target="_blank" rel="noopener" title={label}>
            <img className="vthumb" src={p.url} alt={label} loading="lazy" decoding="async" />
          </a>
        );
      })}
    </div>
  );
}

/** Today's check of a vehicle in one line, from list_vehicles' check_today. */
export function CheckTodayLine({ check }: { check?: CheckToday }) {
  if (!check) return <span className="muted" data-testid="check-today">No check today</span>;
  return (
    <span data-testid="check-today">
      <Pill tone={checkTone(check.result)}>{check.result_text}</Pill>{" "}
      <span className="sub">at <span className="mono">{check.at}</span>{check.by ? ` by ${check.by}` : ""}</span>
    </span>
  );
}

/** "Open the issue" on a problem: the issue of the check's report (list_issues of that vehicle's problems that day). */
function OpenIssue({ c, plate }: { c: VehicleCheck; plate: string }) {
  const { me, transport } = useFleet();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  if (!c.report || !me.tools.includes("list_issues")) return null;
  const report = c.report.id;
  const list = `/issues?kind=vehicle_report&vehicle=${encodeURIComponent(plate)}&status=all`;
  async function open() {
    setBusy(true);
    try {
      const r = await transport.call<IssuesList>("list_issues", { kind: "vehicle_report", vehicle: plate, status: "all", from: c.date, limit: 50 });
      const found = r.issues.find((i) => i.vehicle_report_id === report);
      navigate(found ? `/issues/${found.id}` : list);
    } catch {
      navigate(list);
    }
    setBusy(false);
  }
  return <button type="button" className="btn small" disabled={busy} onClick={() => void open()} data-testid="check-open-issue">{busy ? "Opening…" : "Open the issue"}</button>;
}

/** One check in the 7 days: the time, the result, who, the odometer, how; a problem's note and its issue; the photos. */
function CheckRow({ c, plate, focused, onDeleted }: { c: VehicleCheck; plate: string; focused: boolean; onDeleted: () => void }) {
  return (
    <div id={`check-${c.id}`} className="row" data-testid="check-row" aria-current={focused ? "true" : undefined}
      style={{ alignItems: "flex-start", ...(focused ? { background: "var(--live-bg)", borderRadius: 10 } : {}) }}>
      <span className="mono" style={{ minWidth: 48 }}>{c.at}</span>
      <div className="grow" style={{ display: "grid", gap: 4 }}>
        <div>
          <Pill tone={checkTone(c.result)}>{c.result_text}</Pill>{" "}
          <span className="name">{c.person ?? "—"}</span>
        </div>
        <div className="sub">{[c.odometer_km != null ? `${c.odometer_km.toLocaleString("en-US")} km` : "", c.how_text, c.task?.title].filter(Boolean).join(" · ")}</div>
        {c.report?.note && <div className="sub">“{c.report.note}”</div>}
        <CheckPhotos photos={c.photos} />
        {c.report && <div><OpenIssue c={c} plate={plate} /></div>}
      </div>
      {/* Round 52: a wrong check (approve). */}
      <DeleteEntryButton kind="check" id={c.id} fallback={`/vehicles/${encodeURIComponent(plate)}`} className="btn small" onDeleted={onDeleted} />
    </div>
  );
}

/** The vehicle page's section: Today's check, then the last 7 days by day; `focus` = a check to scroll to (?check=). */
export function VehicleChecksSection({ plate, today: checkToday, focus }: { plate: string; today?: CheckToday; focus?: string | null }) {
  const { me } = useFleet();
  const allowed = me.tools.includes("vehicle_checks");
  const today = colomboDay();
  const q = useQuery<VehicleChecks>("vehicleChecks", "vehicle_checks", lastWeekArgs(plate, today), { enabled: allowed });
  const scrolled = useRef<string | null>(null);
  const has = !!q.data?.checks.some((c) => c.id === focus);
  useEffect(() => {
    if (!focus || !has || scrolled.current === focus) return;
    scrolled.current = focus;
    document.getElementById(`check-${focus}`)?.scrollIntoView?.({ block: "center" });
  }, [focus, has]);
  const days = q.data ? byDay(q.data.checks) : [];
  return (
    <div className="card card-b form" data-testid="vehicle-checks">
      <h2>Vehicle check</h2>
      <div className="kv" style={{ display: "block" }}>
        <div className="section-t">Today's check</div>
        <CheckTodayLine check={checkToday} />
      </div>
      {allowed && (
        <>
          <div className="section-t">Last 7 days{q.data ? ` · ${q.data.total ?? q.data.count}` : ""}{q.data?.problems ? ` · ${q.data.problems} with a problem` : ""}</div>
          {q.loading && <SkeletonRows rows={2} label="Loading the checks…" />}
          {q.err && !q.data && (
            <Notice tone="bad" action={<button type="button" className="btn small" onClick={q.refetch}>Try again</button>}>{errText(q.err as FleetError)[0]}</Notice>
          )}
          {q.data && days.length === 0 && <EmptyLine>No checks in the last 7 days.</EmptyLine>}
          {days.map((d) => (
            <div key={d.date} style={{ display: "grid", gap: 4 }}>
              <div className="sub" style={{ fontWeight: 600 }}>{dayWords(d.date)}</div>
              {d.checks.map((c) => <CheckRow key={c.id} c={c} plate={plate} focused={c.id === focus} onDeleted={q.refetch} />)}
            </div>
          ))}
        </>
      )}
    </div>
  );
}

/** A task's checks: "Vehicle check 07:42 · All good" or "· Problem: Damage", with the photos; Delete… (approve) on a wrong one. */
export function TaskCheckLines({ checks, onDeleted }: { checks?: VehicleCheck[]; onDeleted?: () => void }) {
  if (!checks?.length) return null;
  return (
    <div style={{ gridColumn: "1/-1" }} data-testid="task-checks">
      <dt>Vehicle check</dt>
      <dd style={{ fontWeight: 400, display: "grid", gap: 6 }}>
        {checks.map((c) => (
          <div key={c.id} data-testid="task-check">
            <span className={c.result === "problem" ? "status bad" : undefined}>{taskCheckLine(c)}</span>
            {c.odometer_km != null && <span className="muted"> · {c.odometer_km.toLocaleString("en-US")} km</span>}
            {c.report?.note && <div className="sub">“{c.report.note}”</div>}
            <CheckPhotos photos={c.photos} />
            {onDeleted && <div><DeleteEntryButton kind="check" id={c.id} fallback="/tasks" className="btn small" onDeleted={onDeleted} /></div>}
          </div>
        ))}
      </dd>
    </div>
  );
}
