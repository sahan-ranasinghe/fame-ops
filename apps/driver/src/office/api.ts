// Office mode (Phase 8, O1): the phone's client for office-api, the same rules as the site's ApiTransport
// (apps/office/src/transport: api.ts, retryRule.ts, errors.ts at main ec1bf7d), copied for this round as Sahan asked.
//   GET  /me                 who is signed in: name, permissions, tools, phone, the map package
//   POST /tools/<name> {…}   a tool with the same inputs and JSON answer as the connector; the answer's `result`
// Errors become FleetError { code, message, status, write? } (mapHttpError). The retry rule: only a read (READ_TOOLS = the
// server's readOnly tools, and GET /me) that was dropped on the way (no connection, or a 5xx) is asked again once after
// QUICK_RETRY_MS; a write is never repeated by itself (its error carries write: true, and the screen offers Try again).
// Signed out only on a 401 or 403: a /me that still fails is "did not answer", the session kept (office/auth.ts).
// No phone-only code here (the token and fetch are passed in), so scripts/test-office.ts runs it with a fake server.

import { LOOP_ERROR, LoopBreaker, loopReportBody, sendLoopReport } from '../lib/breaker';
import type { FleetError, Me } from './types';
import { normalisePermissions, permissionsForRole } from './permissions';

/** The tools the server marks readOnly: they change nothing, so a dropped one may be asked again. */
export const READ_TOOLS: ReadonlySet<string> = new Set([
  'activity_log', 'ask_answers', 'availability', 'driver_profile', 'driver_route', 'day_timeline', 'drivers_board', 'duty_log', 'find_people', 'find_project',
  'fleet_overview', 'get_settings', 'holder_asks', 'issue_history', 'list_drivers', 'list_fuel', 'list_import_presets',
  'list_issues', 'list_office_users', 'list_place_imports', 'list_places', 'list_requests', 'list_tasks',
  'list_vehicle_reports', 'list_vehicles', 'live_drivers', 'mileage_summary', 'my_inbox', 'my_notification_settings',
  'my_prefs', 'my_trip', 'my_trips', 'place_detail', 'retention_preview', 'plan_task', 'routing_usage', 'search_places', 'suggest_vehicles',
  'task_board', 'task_detail', 'unavailability', 'vehicle_checks', 'vehicle_documents',
]);

/** Writes the server keys itself, so a repeat changes nothing: the key it checks. */
export const IDEMPOTENT_WRITES: Readonly<Record<string, string>> = {
  reviewing: 'request_viewers upserted on (request_id, employee_id): a repeat only moves seen_at',
};

/** A dropped read is asked again this soon, once, before the screen hears of it. */
export const QUICK_RETRY_MS = 2_000;
/** A call waits this long for its answer: a read 20 s, a write 30 s, the heavy tools 90 s (the website's rule, retryRule.ts). */
export const CALL_TIMEOUT_MS = 20_000;
export const WRITE_TIMEOUT_MS = 30_000;
export const HEAVY_TIMEOUT_MS = 90_000;
export const HEAVY_TOOLS: ReadonlySet<string> = new Set([
  'driver_route', 'mileage_summary', 'list_tasks', 'plan_task', 'create_task', 'update_task_stops', 'book_vehicle',
  'decide_request', 'redecide_request', 'create_request', 'update_request', 'import_places', 'undo_place_import',
]);

/** How long a call may wait (no tool = GET /me, a read). */
export function timeoutFor(tool?: string, base = CALL_TIMEOUT_MS): number {
  if (!tool) return base;
  if (HEAVY_TOOLS.has(tool)) return Math.max(base, HEAVY_TIMEOUT_MS);
  return isWrite(tool) ? Math.max(base, WRITE_TIMEOUT_MS) : base;
}

/** The error of a call that took too long: not a dropped call (a read is not asked again by itself; a write may have worked). */
export const TIMED_OUT = { code: 'timeout', message: 'Fame Fleet took too long to answer.' } as const;

/** Dropped on the way (no connection, or the server gave up: a 5xx), not refused. */
export const dropped = (e: FleetError | undefined | null): boolean =>
  e?.code === 'network' || e?.code === 'upstream_error' || e?.code === 'server_unavailable';

/** A write: never repeated on its own. */
export const isWrite = (tool: string): boolean => !READ_TOOLS.has(tool) && !(tool in IDEMPOTENT_WRITES);

/** The rule: may this failed call be asked again by itself? A read (or a keyed write) that was dropped. */
export const mayRetry = (tool: string, e: FleetError | undefined | null): boolean => !isWrite(tool) && dropped(e);

/** Signed out: only a 401 or 403 (never a server or network error). */
export const signedOut = (e: FleetError | undefined | null): boolean =>
  e?.code === 'not_signed_in' || e?.code === 'not_an_office_user' || e?.code === 'switched_off' || e?.code === 'mfa_required';

interface ApiErrorBody {
  error?: string;
  role?: string;
  issues?: { path: string; message: string }[];
}

/** Turns an office-api answer into the error the screens understand (the site's mapHttpError). */
export function mapHttpError(status: number, body: ApiErrorBody | null): FleetError {
  const err = body?.error ?? '';
  if (status === 401) return { code: 'not_signed_in', message: 'Sign in again.', status };
  if (status === 403) {
    if (err === 'mfa_required' || err === 'not_an_office_user' || err === 'switched_off') return { code: err, message: err, status };
    return { code: 'forbidden', message: err || 'Your role cannot do this.', status };
  }
  if (status === 400) {
    const issues = (body?.issues ?? []).map((i) => (i.path ? `${i.path}: ${i.message}` : i.message)).join('; ');
    return { code: 'bad_input', message: issues ? `Check ${issues}` : err || 'Something in the form is not right.', status };
  }
  if (status === 404) return { code: 'no_such_tool', message: 'That tool does not exist.', status };
  if (status === 409) return { code: 'tool_error', message: err || 'Fame Fleet refused the request.', status };
  // Round 48: the server's own sentence when it sends one ("Too many requests · try again in a minute").
  if (status === 429) return { code: 'rate_limited', message: (body as { message?: string } | null)?.message || 'Too many requests · try again in a minute', status };
  return { code: 'upstream_error', message: err || 'Fame Fleet did not answer.', status };
}

/** The rule's one retry: `run` again once, after QUICK_RETRY_MS, when its error is one `may` allows; else it throws at once. */
export async function onceMore<T>(run: () => Promise<T>, may: (e: FleetError) => boolean, waitMs = QUICK_RETRY_MS): Promise<T> {
  try {
    return await run();
  } catch (e) {
    if (!may(e as FleetError)) throw e;
    await new Promise((r) => setTimeout(r, waitMs));
    return run();
  }
}

export interface OfficeApiDeps {
  /** `${SUPABASE_URL}/functions/v1/office-api`. */
  baseUrl: string;
  /** The publishable key (the apikey header the gateway wants). */
  apiKey: string;
  /** The session's token; null when signed out; throws a network FleetError when its refresh did not get through. */
  token: () => Promise<string | null>;
  fetch?: typeof fetch;
  /** For tests: no wait before the retry. */
  retryWaitMs?: number;
  timeoutMs?: number;
  /** Round 48 (6c): the circuit breaker per tool (tests pass one with their own clock). */
  breaker?: LoopBreaker;
  /** What the one loop report says about where it happened (the screen, the app's version); none in tests. */
  context?: () => { screen?: string; app_version?: string };
}

export interface OfficeApi {
  me(): Promise<Me>;
  call<T = unknown>(tool: string, args?: Record<string, unknown>): Promise<T>;
}

export function createOfficeApi(deps: OfficeApiDeps): OfficeApi {
  const doFetch = deps.fetch ?? fetch;
  const base = deps.baseUrl.replace(/\/$/, '');
  const breaker = deps.breaker ?? new LoopBreaker();

  /** The breaker before a tool call: a looping screen is stopped here and reported once (never a report per refused call). */
  async function guard(tool: string): Promise<void> {
    const v = breaker.check(tool);
    if (!v.open) return;
    if (v.report) {
      const token = await deps.token().catch(() => null);
      if (token) sendLoopReport(base, deps.apiKey, token, loopReportBody(tool, v.calls, 'office', deps.context?.() ?? {}), doFetch);
    }
    throw { ...LOOP_ERROR } satisfies FleetError;
  }

  async function request<T>(method: 'GET' | 'POST', path: string, body?: unknown, tool?: string): Promise<T> {
    const token = await deps.token();
    if (!token) throw { code: 'not_signed_in', message: 'Sign in again.', status: 401 } satisfies FleetError;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), deps.timeoutMs ?? timeoutFor(tool));
    let res: Response;
    try {
      res = await doFetch(base + path, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          apikey: deps.apiKey,
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
    } catch {
      clearTimeout(timer);
      if (controller.signal.aborted) throw { ...TIMED_OUT } satisfies FleetError;
      throw { code: 'network', message: 'No connection to Fame Fleet.' } satisfies FleetError;
    }
    // The timeout covers the body too: a reply that stalls half-way ends as a dropped call (ui-patterns §5; Hotfix O2-H2,
    // Part 1b: never a spinner that turns for ever).
    let text: string;
    try {
      text = await res.text();
    } catch {
      if (controller.signal.aborted) throw { ...TIMED_OUT } satisfies FleetError;
      throw { code: 'network', message: 'No connection to Fame Fleet.' } satisfies FleetError;
    } finally {
      clearTimeout(timer);
    }
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    if (!res.ok) throw mapHttpError(res.status, json as ApiErrorBody | null);
    return json as T;
  }

  return {
    async me() {
      // A read under the retry rule: a dropped /me is asked again once.
      const m = await onceMore(() => request<Me & { permissions?: unknown[] }>('GET', '/me'), dropped, deps.retryWaitMs);
      // An office-api from before the permissions column answers none: the role's defaults then.
      return { ...m, permissions: m.permissions ? normalisePermissions(m.permissions) : permissionsForRole(m.role) };
    },
    async call<T>(tool: string, args: Record<string, unknown> = {}): Promise<T> {
      await guard(tool);
      const run = async () => (await request<{ result: T }>('POST', `/tools/${tool}`, args, tool)).result;
      try {
        return await onceMore(run, (e) => mayRetry(tool, e), deps.retryWaitMs);
      } catch (e) {
        const error = e as FleetError;
        throw isWrite(tool) ? { ...error, write: true } : error;
      }
    },
  };
}
