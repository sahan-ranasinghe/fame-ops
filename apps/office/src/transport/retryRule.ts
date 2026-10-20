// The one retry rule of the office app (Sahan, 19 October 2026), for both builds:
// - Only reads are asked again by themselves: a read that was dropped on the way (no connection, or the server gave up: a
//   5xx) is asked again once, after QUICK_RETRY_MS, before the page hears of it.
// - A write (approve, assign, cancel, save …) is never repeated on its own: the person sees "may not have been saved" and
//   a Try again button that repeats what they pressed (ui/WriteRetry.tsx). The exception is a write the server keys itself,
//   so a repeat changes nothing: IDEMPOTENT_WRITES, each with the key the server checks.
// READ_TOOLS is the server's own readOnly flag of every tool (retryRule.test.tsx reads the tool files and keeps them equal).
// GET /me is a read too (ApiTransport.me): asked again the same way, and a /me that still fails never signs anyone out
// (auth/AuthProvider: only a 401 or 403 does).
import type { FleetError, Transport } from "./types";

/** The tools the server marks readOnly: they change nothing, so a dropped one may be asked again. */
export const READ_TOOLS: ReadonlySet<string> = new Set([
  "ask_answers", "availability", "driver_profile", "driver_route", "drivers_board", "duty_log", "find_project",
  "fleet_overview", "get_settings", "issue_history", "list_drivers", "list_fuel", "list_import_presets",
  "list_issues", "list_office_users", "list_place_imports", "list_places", "list_requests", "list_tasks",
  "list_vehicle_reports", "list_vehicles", "live_drivers", "mileage_summary", "my_inbox", "my_notification_settings",
  "my_prefs", "my_trips", "place_detail", "plan_task", "routing_usage", "search_places", "suggest_vehicles",
  "task_board", "task_detail", "unavailability", "vehicle_documents",
]);

/** Writes the server keys itself, so a repeat changes nothing: the key it checks. */
export const IDEMPOTENT_WRITES: Readonly<Record<string, string>> = {
  reviewing: "request_viewers upserted on (request_id, employee_id): a repeat only moves seen_at",
};

/** Writes made by the page itself in the background, never by a press: no Try again for them (they come again on their own schedule). */
export const BACKGROUND_WRITES: ReadonlySet<string> = new Set(["reviewing", "watch_drivers", "set_my_prefs", "register_map_load"]);

/**
 * No call waits forever (docs/ui-patterns.md §5): a read gives up after 20 s, a write after 30 s, the place search's
 * suggestions after 15 s; then the page shows the error with Try again (a write's "may not have been saved").
 */
export const READ_TIMEOUT_MS = 20_000;
export const WRITE_TIMEOUT_MS = 30_000;
export const SUGGEST_TIMEOUT_MS = 15_000;
/** The suggestions asked while someone types. */
export const SUGGEST_TOOLS: ReadonlySet<string> = new Set(["search_places"]);

/**
 * The heavy tools get longer (Stage 0 review): a route with its estimated roads (up to 25 openrouteservice calls), a year
 * of mileage or tasks, a plan with Google's or openrouteservice's legs, a 500-row import and its undo. Their own timings
 * on the real project stay well under these; a cut write would show "may not have been saved" for a write that worked.
 */
export const HEAVY_TIMEOUT_MS = 90_000;
export const HEAVY_TOOLS: ReadonlySet<string> = new Set([
  "driver_route", "mileage_summary", "list_tasks", "plan_task", "create_task", "update_task_stops", "book_vehicle",
  "decide_request", "redecide_request", "create_request", "update_request", "import_places", "undo_place_import",
]);

/** How long a call may take (GET /me is a read). */
export function timeoutFor(tool?: string): number {
  if (!tool) return READ_TIMEOUT_MS;
  if (SUGGEST_TOOLS.has(tool)) return SUGGEST_TIMEOUT_MS;
  if (HEAVY_TOOLS.has(tool)) return HEAVY_TIMEOUT_MS;
  return isWrite(tool) ? WRITE_TIMEOUT_MS : READ_TIMEOUT_MS;
}

/** The error of a call that took too long. */
export const TIMED_OUT = { code: "timeout", message: "Fame Fleet took too long to answer." } as const;

/** A dropped read is asked again this soon, once, before the page hears of it. */
export const QUICK_RETRY_MS = 2_000;

/** Dropped on the way (no connection, or the server gave up: a 5xx), not refused. */
export const dropped = (e: FleetError | undefined | null) =>
  e?.code === "network" || e?.code === "upstream_error" || e?.code === "server_unavailable";

/** A write: never repeated on its own. */
export const isWrite = (tool: string) => !READ_TOOLS.has(tool) && !(tool in IDEMPOTENT_WRITES);

/** The rule: may this failed call be asked again by itself? A read (or a keyed write) that was dropped. */
export const mayRetry = (tool: string, e: FleetError | undefined | null) => !isWrite(tool) && dropped(e);

/** The rule's one retry: `run` again once, after QUICK_RETRY_MS, when its error is one `may` allows; else it throws at once. */
export async function onceMore<T>(run: () => Promise<T>, may: (e: FleetError) => boolean): Promise<T> {
  try {
    return await run();
  } catch (e) {
    if (!may(e as FleetError)) throw e;
    await new Promise((r) => setTimeout(r, QUICK_RETRY_MS));
    return run();
  }
}

/** A call under the rule: a dropped read is asked again once after QUICK_RETRY_MS; anything else throws at once. */
export function callWithRetry<T>(transport: Pick<Transport, "call">, tool: string, args: Record<string, unknown> = {}): Promise<T> {
  return onceMore(() => transport.call<T>(tool, args), (e) => mayRetry(tool, e));
}
