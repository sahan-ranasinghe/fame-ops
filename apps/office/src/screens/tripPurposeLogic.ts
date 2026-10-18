// Phase 7 (§13), the office's side of a trip a driver started in the app: the tags on the board and the task page
// ("Driver-started", "Personal"), set_trip_purpose's input (Company work ↔ Personal, a project attached to company work)
// and the line shown after it. Settings → Fleet's driver_personal_trips in plain words. Pure.
import type { FleetSettings, TaskKind, TripPurpose, TripPurposeResult } from "../data/types";

export interface TripTag {
  label: string;
  tone: "live" | "warn";
}

/** "Driver-started" for a trip the driver started (kind self), "Personal" for a personal one; none for the office's tasks. */
export function tripTags(t: { kind?: TaskKind; purpose?: TripPurpose }): TripTag[] {
  const out: TripTag[] = [];
  if (t.kind === "self") out.push({ label: "Driver-started", tone: "live" });
  if (t.purpose === "personal") out.push({ label: "Personal", tone: "warn" });
  return out;
}

export const PURPOSE_TEXT: Record<TripPurpose, string> = { company: "Company work", personal: "Personal" };

/**
 * set_trip_purpose's arguments, or why not: a personal trip takes no project (the server says the same); nothing changed
 * (the same purpose and no project typed) is not sent.
 */
export function purposeInput(
  taskId: string,
  was: TripPurpose | undefined,
  purpose: TripPurpose,
  project: string,
): { input: { task_id: string; purpose: TripPurpose; project?: string } } | { error: string } {
  const p = project.trim();
  if (p && purpose === "personal") return { error: "A personal trip has no project: choose Company work to attach one." };
  if (!p && purpose === (was ?? "company")) return { error: "Nothing to change yet." };
  return { input: { task_id: taskId, purpose, ...(p ? { project: p } : {}) } };
}

/** The line after a save: "Now personal: its km are counted apart from the jobs." / "Company work · charged to TRKAN1". */
export function purposeDoneText(r: TripPurposeResult): string {
  if (r.purpose === "personal") return `Now personal${r.note ? `: ${r.note.charAt(0).toLowerCase()}${r.note.slice(1)}` : ": its km are counted apart from the jobs."}`;
  const project = r.project ? ` · charged to ${r.project}` : "";
  return r.was === "personal" ? `Now company work${project}` : `Company work${project}`;
}

export type PersonalTrips = NonNullable<FleetSettings["driver_personal_trips"]>;

/** driver_personal_trips: its four values in plain words, in this order. */
export const PERSONAL_TRIPS_OPTIONS: [PersonalTrips, string][] = [
  ["allowed", "Allowed: Company work preselected, Personal offered"],
  ["default", "Personal preselected"],
  ["off", "Off: no Personal choice"],
  ["ask_first", "Ask first (not built yet: works as Allowed)"],
];

/** The value shown: the saved one, else the server's default, else allowed. */
export function personalTripsValue(saved?: string | null, fallback?: string | null): PersonalTrips {
  const known = (v?: string | null): v is PersonalTrips => PERSONAL_TRIPS_OPTIONS.some(([k]) => k === v);
  return known(saved) ? saved : known(fallback) ? fallback : "allowed";
}
