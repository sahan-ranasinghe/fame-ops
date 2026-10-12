// The web build: the same tools through the Edge Function office-api, with
// the person's Supabase session. office-api checks the session, the role and
// the second step on every call and audits it with the person's name.
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

  private async request<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
    const token = await this.token();
    if (!token) throw { code: "not_signed_in", message: "Sign in again.", status: 401 } satisfies FleetError;
    let res: Response;
    try {
      res = await this.fetchFn(this.base + path, {
        method,
        headers: { authorization: `Bearer ${token}`, ...(body !== undefined ? { "content-type": "application/json" } : {}) },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    } catch {
      throw { code: "network", message: "No connection to Fame Fleet." } satisfies FleetError;
    }
    const text = await res.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    if (!res.ok) throw mapHttpError(res.status, json as ApiErrorBody | null);
    return json as T;
  }

  me(): Promise<Me> {
    return this.request<Me>("GET", "/me");
  }

  async call<T>(tool: string, args: Record<string, unknown> = {}): Promise<T> {
    const out = await this.request<{ result: T }>("POST", `/tools/${tool}`, args);
    return out.result;
  }

  watch<T>(tool: string, args: Record<string, unknown>, cb: (ev: WatchEvent<T>) => void, intervalMs: number): () => void {
    let stopped = false;
    let running = false;
    const tick = async () => {
      if (stopped || running) return;
      running = true;
      try {
        const data = await this.call<T>(tool, args);
        if (!stopped) cb({ type: "data", data, at: Date.now() });
      } catch (e) {
        if (!stopped) cb({ type: "error", error: e as FleetError });
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
      this.watchers.delete(tick);
    };
  }

  async invalidate(): Promise<void> {
    await Promise.all([...this.watchers].map((t) => t()));
  }
}
