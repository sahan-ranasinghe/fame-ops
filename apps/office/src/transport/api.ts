// The web build: the same tools through the Edge Function office-api, with
// the person's Supabase session. office-api checks the session, the role and
// the second step on every call and audits it with the person's name.
import { normalisePermissions, permissionsForRole } from "@fleet/permissions";
import { emitWriteDropped, gestureOrigin } from "./gesture";
import { BACKGROUND_WRITES, dropped, isWrite, mayRetry, onceMore, QUICK_RETRY_MS, TIMED_OUT, timeoutFor } from "./retryRule";
import type { FleetError, Me, Transport, WatchEvent } from "./types";

type TokenSource = () => Promise<string | null>;

interface ApiErrorBody {
  error?: string;
  role?: string;
  issues?: { path: string; message: string }[];
}

/** Turns an office-api answer into the error the screens understand. */
export function mapHttpError(status: number, body: ApiErrorBody | null): FleetError {
  const err = body?.error ?? "";
  if (status === 401) return { code: "not_signed_in", message: "Sign in again.", status };
  if (status === 403) {
    if (err === "mfa_required" || err === "not_an_office_user" || err === "switched_off") return { code: err, message: err, status };
    return { code: "forbidden", message: err || "Your role cannot do this.", status };
  }
  if (status === 400) {
    const issues = (body?.issues ?? []).map((i) => (i.path ? `${i.path}: ${i.message}` : i.message)).join("; ");
    return { code: "bad_input", message: issues ? `Check ${issues}` : err || "Something in the form is not right.", status };
  }
  if (status === 404) return { code: "no_such_tool", message: "That tool does not exist.", status };
  if (status === 409) return { code: "tool_error", message: err || "Fame Fleet refused the request.", status };
  if (status === 429) return { code: "rate_limited", message: "Too many calls in a minute. Wait a moment.", status };
  return { code: "upstream_error", message: err || "Fame Fleet did not answer.", status };
}

export class ApiTransport implements Transport {
  readonly kind = "api" as const;
  private watchers = new Set<() => void>();

  constructor(private base: string, private token: TokenSource, private fetchFn: typeof fetch = (...a) => fetch(...a)) {
    this.base = base.replace(/\/$/, "");
  }

  private async request<T>(method: "GET" | "POST", path: string, body?: unknown, timeoutMs = timeoutFor()): Promise<T> {
    const token = await this.token();
    if (!token) throw { code: "not_signed_in", message: "Sign in again.", status: 401 } satisfies FleetError;
    let res: Response;
    let text: string;
    // No call waits forever (retryRule.ts timeoutFor): the request is cut off and the page says it took too long.
    const ctrl = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      ctrl.abort();
    }, timeoutMs);
    try {
      res = await this.fetchFn(this.base + path, {
        method,
        headers: { authorization: `Bearer ${token}`, ...(body !== undefined ? { "content-type": "application/json" } : {}) },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: ctrl.signal,
      });
      text = await res.text();
    } catch {
      if (timedOut) throw { ...TIMED_OUT } satisfies FleetError;
      throw { code: "network", message: "No connection to Fame Fleet." } satisfies FleetError;
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

  async me(): Promise<Me> {
    // A read under the retry rule (retryRule.ts): a dropped /me is asked again once, after QUICK_RETRY_MS.
    const m = await onceMore(() => this.request<Me & { permissions?: unknown[] }>("GET", "/me"), dropped);
    // An office-api from before the permissions column answers none: the role's defaults then.
    return { ...m, permissions: m.permissions ? normalisePermissions(m.permissions) : permissionsForRole(m.role) };
  }

  async call<T>(tool: string, args: Record<string, unknown> = {}): Promise<T> {
    // What the person pressed to start it (a write they may want to try again), taken before the call waits.
    const origin = isWrite(tool) && !BACKGROUND_WRITES.has(tool) ? gestureOrigin() : null;
    try {
      const out = await this.request<{ result: T }>("POST", `/tools/${tool}`, args, timeoutFor(tool));
      return out.result;
    } catch (e) {
      const error = e as FleetError;
      if (!isWrite(tool)) throw error;
      // A write is never repeated on its own: the page says it may not have been saved, and Try again (ui/WriteRetry)
      // presses the same button again when the person chooses to.
      if ((dropped(error) || error.code === TIMED_OUT.code) && origin) emitWriteDropped(tool, origin);
      throw { ...error, write: true } satisfies FleetError;
    }
  }

  watch<T>(tool: string, args: Record<string, unknown>, cb: (ev: WatchEvent<T>) => void, intervalMs: number): () => void {
    let stopped = false;
    let running = false;
    // Part 6: a dropped request (no connection, or the server gave up: a 5xx) is asked again after QUICK_RETRY_MS, once,
    // before the page says "didn't answer"; only a second failure is shown, and then the next try is the interval's.
    // Before, a page waited its whole interval (30–60 s) after one dropped request.
    let quickTried = false;
    let quick: ReturnType<typeof setTimeout> | null = null;
    const tick = async () => {
      if (stopped || running) return;
      running = true;
      try {
        const data = await this.call<T>(tool, args);
        quickTried = false;
        if (!stopped) cb({ type: "data", data, at: Date.now() });
      } catch (e) {
        const error = e as FleetError;
        if (!stopped && !quickTried && mayRetry(tool, error)) {
          quickTried = true;
          quick = setTimeout(() => { quick = null; void tick(); }, QUICK_RETRY_MS);
        } else if (!stopped) cb({ type: "error", error });
      } finally {
        running = false;
      }
    };
    void tick();
    const timer = setInterval(() => void tick(), intervalMs);
    this.watchers.add(tick);
    return () => {
      stopped = true;
      clearInterval(timer);
      if (quick) clearTimeout(quick);
      this.watchers.delete(tick);
    };
  }

  async invalidate(): Promise<void> {
    await Promise.all([...this.watchers].map((t) => t()));
  }
}
