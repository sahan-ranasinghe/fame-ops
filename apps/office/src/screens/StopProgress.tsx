// A task's stops as a vertical delivery timeline (Round 2, 21 October 2026). The industry pattern: the route progress of
// Uber's and DoorDash's order tracking and Samsara's route view: one rail top to bottom, a dot per stop (done, here now,
// still to come), each stop with what was planned against what happened ("Planned 10:30 · Arrived 10:52 · Left 11:40"),
// the difference in words ("22 min late" amber; "8 min early" or "On time" green: within 2 minutes, deltaKind from
// @fleet/stopProgress, the rule every surface reads), the stop the driver is at or heading to marked, and the stops still
// to come with their new time ("about 12:10 (updated 10:52)"). The ONE component for a task's stops with times on the
// site (docs/ui-patterns.md "Stop progress timeline"); the app's twin is components/office/StopTimeline.tsx.
import type { ReactNode } from "react";
import { deltaKind } from "@fleet/stopProgress";
import { duration } from "@fleet/durations";
import type { Stop } from "../data/types";
import { joinDots } from "../lib/format";
import { Pill } from "../ui/basics";
import { stayLine, stopTitle } from "./taskDetailLogic";

/** Why a stop was skipped, in words (task_detail answers the code). Never the code on the screen. */
export const SKIP_WORDS: Record<string, string> = {
  closed: "Closed",
  nobody_there: "Nobody there",
  not_needed: "Not needed",
  not_visited: "Not visited (task finished)",
  other: "Other",
};
export const skipWords = (reason: string | undefined): string => (reason ? SKIP_WORDS[reason] ?? "Other" : "");

export type Progress = NonNullable<Stop["progress"]>;

/** "Planned 10:30–11:00 · Arrived 10:52 · Left 11:40"; empty when nothing is known. */
export function progressTimes(p: Progress): string {
  const planned = p.planned_arrive
    ? `Planned ${p.planned_arrive}${p.planned_leave && p.planned_leave !== p.planned_arrive ? `–${p.planned_leave}` : ""}`
    : "";
  return joinDots([planned, p.arrived ? `Arrived ${p.arrived}` : "", p.left ? `Left ${p.left}` : ""]);
}

/** The arrival's difference against the plan in words (the same rule as the app's; Checkpoint 2 review). Null when the
 *  driver has not arrived. */
export function progressDelta(p: Progress): { text: string; late: boolean } | null {
  const d = deltaKind(p.arrive_delta_min ?? null);
  if (!d) return null;
  if (d.kind === "on_time") return { text: "On time", late: false };
  return { text: `${duration(d.min)} ${d.kind === "late" ? "late" : "early"}`, late: d.kind === "late" };
}

/** A stop still to come once something was confirmed: "about 12:10 (updated 10:52)". */
export function progressEstimate(p: Progress): string {
  return p.estimate ? `about ${p.estimate.arrive} (updated ${p.estimate.updated})` : "";
}

type StopRow = Stop & { progress?: Progress };

const dotOf = (s: Stop) =>
  s.status === "done" ? "ok" : s.status === "skipped" ? "bad" : s.status === "arrived" ? "live" : "";

/**
 * The timeline. `extra` adds a surface's own lines under a stop (the task page: what is carried, the note, the arrival
 * flag, Save as our place); `action` a button on the right (Map). An answer without `progress` (an older server) shows
 * the planned and actual stay as before.
 */
export function StopProgress({ stops, extra, action }: {
  stops: StopRow[];
  extra?: (s: StopRow) => ReactNode;
  action?: (s: StopRow) => ReactNode;
}) {
  return (
    <ol className="sp-timeline" data-testid="stop-progress">
      {stops.map((s) => {
        const p = s.progress;
        const here = !!p?.current && s.status === "arrived";
        // A skipped stop: no times or difference of its own (the server sends none either; Checkpoint 2 review).
        const skipped = s.status === "skipped";
        const times = p && !skipped ? progressTimes(p) : "";
        const delta = p && !skipped ? progressDelta(p) : null;
        const estimate = p && !s.arrived ? progressEstimate(p) : "";
        const stay = !p ? stayLine(s) : "";
        return (
          <li key={s.seq} className={`sp-stop${p?.current ? " current" : ""}`} data-testid="task-stop" aria-current={p?.current ? "step" : undefined}>
            <span className={`dot ${dotOf(s)}`} aria-hidden="true" />
            <div className="grow">
              <div className="name">
                {stopTitle(s)}
                {p?.current && <Pill tone="live">{here ? "Here now" : "Next"}</Pill>}
                {s.is_start && <Pill tone="live">Start · passengers get in here</Pill>}
                {s.google && <span translate="no"><Pill tone="live">Google Maps</Pill></span>}
              </div>
              {(times || delta) && (
                <div className="sub num" data-testid="stop-times">
                  {times}
                  {delta && <>{times ? " · " : ""}<b className={`sp-delta ${delta.late ? "late" : "ok"}`} data-testid="stop-delta">{delta.text}</b></>}
                </div>
              )}
              {estimate && <div className="sub num" data-testid="stop-estimate">{estimate}</div>}
              {stay && <div className="sub" data-testid="stop-stay">{stay}</div>}
              {s.status === "skipped" && (
                <div className="status bad" data-testid="stop-skipped">
                  {joinDots(["Skipped", skipWords(s.skip_reason)])}{s.skip_note ? ` (${s.skip_note})` : ""}
                </div>
              )}
              {extra?.(s)}
            </div>
            {action?.(s)}
          </li>
        );
      })}
    </ol>
  );
}
