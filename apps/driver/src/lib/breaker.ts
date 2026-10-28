// The app's circuit breaker (Round 48, item 6c): a screen that asks the same endpoint over and over from a render or
// effect loop is stopped here, before the server has to refuse it. The same rule as the site's transport/breaker.ts:
// more than LOOP_LIMIT calls of one endpoint in a minute opens the breaker for that endpoint for LOOP_OPEN_MS; every
// call meanwhile fails at once with LOOP_ERROR (code 'loop'; office/text.ts and the driver side say it in the person's
// language) and nothing is sent. Why 30: a screen asks an endpoint at most twice a minute by itself and a person cannot
// press a button 30 times in a minute, while an effect loop reaches 30 within seconds; it is also the server's budget
// for the tools that cost (30 a minute), so the phone stops before the server does. One report per endpoint per
// LOOP_REPORT_MS goes through the app's error reporting (office-api / driver-api POST /errors), Sentry-style: the call
// that opens the breaker, never one per refused call. Pure (an injected clock): scripts/test-breaker.ts.

export const LOOP_LIMIT = 30;
export const LOOP_OPEN_MS = 60_000;
export const LOOP_REPORT_MS = 600_000;
export const LOOP_ERROR = { code: 'loop', message: 'This screen asked the server too often · try again in a minute' } as const;

interface Track {
  /** The calls in the last minute. */
  stamps: number[];
  /** Closed until (0 = open for calls). */
  until: number;
  /** When the last report went out. */
  reportedAt: number;
}

export type Verdict = { open: false } | { open: true; report: boolean; calls: number };

export class LoopBreaker {
  private tracks = new Map<string, Track>();
  readonly limit: number;
  readonly openMs: number;
  readonly reportMs: number;

  constructor(opts: { limit?: number; openMs?: number; reportMs?: number } = {}, private clock: () => number = () => Date.now()) {
    this.limit = opts.limit ?? LOOP_LIMIT;
    this.openMs = opts.openMs ?? LOOP_OPEN_MS;
    this.reportMs = opts.reportMs ?? LOOP_REPORT_MS;
  }

  /** Before a call of `endpoint`: may it go, and if not, is this the one report. */
  check(endpoint: string): Verdict {
    const now = this.clock();
    let t = this.tracks.get(endpoint);
    if (!t) {
      t = { stamps: [], until: 0, reportedAt: -Infinity };
      this.tracks.set(endpoint, t);
    }
    if (t.until > now) return { open: true, report: false, calls: t.stamps.length };
    t.until = 0;
    t.stamps = t.stamps.filter((s) => now - s < 60_000);
    t.stamps.push(now);
    if (t.stamps.length <= this.limit) return { open: false };
    t.until = now + this.openMs;
    const report = now - t.reportedAt >= this.reportMs;
    if (report) t.reportedAt = now;
    return { open: true, report, calls: t.stamps.length };
  }

  /** Tests: forget everything. */
  reset(): void {
    this.tracks.clear();
  }
}

/** The one report's text: which endpoint, how often. */
export function loopReportMessage(endpoint: string, calls: number): string {
  return `Loop: ${endpoint} asked ${calls} times in a minute; stopped for a minute`;
}

/** The report's body (appErrors.ts APP_ERROR_INPUT): the loop, the screen, the app; never personal data. */
export function loopReportBody(endpoint: string, calls: number, side: 'office' | 'driver', ctx: { screen?: string; app_version?: string } = {}): Record<string, unknown> {
  return {
    message: loopReportMessage(endpoint, calls),
    ...(ctx.screen ? { screen: ctx.screen.slice(0, 200) } : {}),
    ...(ctx.app_version ? { app_version: ctx.app_version.slice(0, 40) } : {}),
    side,
    fatal: false,
    at: new Date().toISOString(),
  };
}

/** Posts a report to `${base}/errors` with the token; never waited for, never an error of its own. */
export function sendLoopReport(base: string, apiKey: string, token: string, body: Record<string, unknown>, fetchFn: typeof fetch): void {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5_000);
    fetchFn(`${base}/errors`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, apikey: apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    }).then(() => clearTimeout(timer), () => clearTimeout(timer));
  } catch {
    // A report that does not get through is dropped: it must never become an error of its own.
  }
}
