// Rate limits (Round 48, item 6b): one token bucket for every door of the server.
//
// A bucket holds `capacity` tokens and refills at `capacity` a minute (so a steady caller gets capacity calls a
// minute and a burst at most capacity at once); a call takes one token, and a caller with no token left gets a
// 429 with one sentence everywhere (RATE_LIMITED: office-api and driver-api as JSON, the connector as a tool error,
// the site and the app turn the code into words in the person's language). The clock is injected (tests), and the
// map of keys is bounded (a flood of addresses cannot grow it without end: the quiet keys go first).
//
// Where the buckets sit (one module-level instance per Edge Function isolate; the platform runs a few isolates, so
// the real limit is a small multiple of these numbers, enough to stop a loop or a flood, never a person):
//   general   office-api 120 a minute per person (as before), driver-api 60 a minute per driver, office-mcp 120 a
//             minute per key (the shared key and each personal key)
//   paid      PAID_TOOLS (the tools that can make a Google, openrouteservice or Gemini call) 30 a minute per
//             person, per driver, per key, on top of the general one: the budget of a screen in a loop, never of a
//             person at work (a planner asks a handful of plans a minute at most)
//   unauth    20 a minute per address on the doors that answer without a person: a wrong or missing connector key
//             (before the key is looked up in the database), a request office-api or driver-api refused (401,
//             403, 404) — checked BEFORE Supabase Auth is asked, charged after the refusal, so an address guessing
//             keys or tokens costs the database and Auth at most 20 lookups a minute.

export interface BucketOptions {
  /** Tokens a key holds at most, and gets back every minute. */
  capacity: number;
  /** Keys kept at most (the quiet ones are forgotten first). */
  maxKeys?: number;
}

export const DEFAULT_MAX_KEYS = 5000;

interface Bucket {
  tokens: number;
  at: number;
}

/** Token buckets by key: `take` spends one token (false = none left), `peek` says how many are left, `charge` spends one without an answer. */
export class TokenBuckets {
  private buckets = new Map<string, Bucket>();
  readonly capacity: number;
  readonly maxKeys: number;

  constructor(opts: BucketOptions, private clock: () => number = () => Date.now()) {
    this.capacity = Math.max(1, opts.capacity);
    this.maxKeys = Math.max(1, opts.maxKeys ?? DEFAULT_MAX_KEYS);
  }

  private refilled(key: string, now: number): Bucket {
    const b = this.buckets.get(key);
    if (!b) {
      const fresh = { tokens: this.capacity, at: now };
      this.bound(now);
      this.buckets.set(key, fresh);
      return fresh;
    }
    const perMs = this.capacity / 60_000;
    b.tokens = Math.min(this.capacity, b.tokens + Math.max(0, now - b.at) * perMs);
    b.at = now;
    return b;
  }

  /** Keeps the map under maxKeys: the full (quiet) keys go first, then the longest unseen. */
  private bound(now: number): void {
    if (this.buckets.size < this.maxKeys) return;
    const perMs = this.capacity / 60_000;
    for (const [k, b] of this.buckets) {
      if (b.tokens + Math.max(0, now - b.at) * perMs >= this.capacity) this.buckets.delete(k);
      if (this.buckets.size < this.maxKeys) return;
    }
    // Still full: the entries were inserted in time order, so the first is the oldest.
    const oldest = this.buckets.keys().next();
    if (!oldest.done) this.buckets.delete(oldest.value);
  }

  /** One token for this key now: true when it had one. */
  take(key: string): boolean {
    const b = this.refilled(key, this.clock());
    if (b.tokens < 1) return false;
    b.tokens -= 1;
    return true;
  }

  /** Whether the key has a token left, without taking it. */
  has(key: string): boolean {
    return this.refilled(key, this.clock()).tokens >= 1;
  }

  /** Spends a token after the fact (a refusal charged to the address that caused it); never below zero. */
  charge(key: string): void {
    const b = this.refilled(key, this.clock());
    b.tokens = Math.max(0, b.tokens - 1);
  }

  /** Tokens left, rounded down. */
  peek(key: string): number {
    return Math.floor(this.refilled(key, this.clock()).tokens);
  }

  get size(): number {
    return this.buckets.size;
  }
}

/** The one sentence, everywhere: the JSON body of a 429, the connector's tool error, the clients' words. */
export const RATE_LIMITED = { code: "rate_limited", message: "Too many requests · try again in a minute" } as const;

/** The 429 answer (office-api adds its CORS headers). */
export function rateLimitedResponse(headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify({ error: RATE_LIMITED.code, code: RATE_LIMITED.code, message: RATE_LIMITED.message }), {
    status: 429,
    headers: { ...headers, "content-type": "application/json; charset=utf-8", "retry-after": "60" },
  });
}

/**
 * The caller's address as the platform saw it: the LAST x-forwarded-for entry (the gateway appends it; a caller can only
 * add entries before it), and x-real-ip only when there is no x-forwarded-for at all (review M2: a header the caller
 * may set must never win over the one the gateway appends, or the per-address limit is a no-op against key guessing).
 */
export function clientIp(headers: Headers): string {
  const forwarded = (headers.get("x-forwarded-for") ?? "").split(",").pop()?.trim();
  return forwarded || headers.get("x-real-ip")?.trim() || "unknown";
}

/**
 * Local and CI only (the functions' env file, like FLEET_NOW; never a secret of the real project): the connector suite
 * and the e2e make hundreds of calls a minute with one key or one person, which no office does. A multiplier on every
 * bucket; absent or 1 = the limits as written.
 */
const SCALE = (() => {
  const v = Number((globalThis as { Deno?: { env: { get(k: string): string | undefined } } }).Deno?.env.get("FLEET_RATE_SCALE") ?? "1");
  return Number.isFinite(v) && v >= 1 && v <= 1000 ? v : 1;
})();
export const GENERAL_PER_MINUTE = 120 * SCALE;
export const DRIVER_PER_MINUTE = 60 * SCALE;
export const PAID_PER_MINUTE = 30 * SCALE;
export const UNAUTH_PER_IP_PER_MINUTE = 20 * SCALE;

/**
 * The tools that can make a paid or capped call (docs/google-maps-setup.md section 7; the audit of Round 48):
 * the place search's Google and openrouteservice layers, a Google place's details, every plan (Google Routes or
 * openrouteservice directions), a route's snap to roads and estimated gap lines, the counted Google map load, and a
 * running task's Google ETA (task_detail). The lists that ask an openrouteservice ETA (live_drivers, task_board,
 * fleet_overview) stay under the general limit: the ETA is cached two minutes a task and openrouteservice is free.
 */
export const PAID_TOOLS: ReadonlySet<string> = new Set([
  "search_places",
  "google_place",
  "register_map_load",
  "plan_task",
  "create_task",
  "update_task_stops",
  "update_task",
  "reassign_task",
  "create_request",
  "update_request",
  "decide_request",
  "redecide_request",
  "book_vehicle",
  "driver_route",
  // task_detail is NOT here: its one Google call (a running task's ETA) is cached 15 minutes, and the task page is opened
  // many times a minute in ordinary dispatching (and by the e2e); the general 120 a minute covers it.
]);
