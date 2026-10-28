// The client's circuit breaker (Round 48, item 6c): a screen that asks the same tool over and over from a render or
// effect loop is stopped here, before the server has to refuse it.
//
// The rule: more than LOOP_LIMIT calls of one tool in a minute from this page opens the breaker for that tool for
// LOOP_OPEN_MS; every call meanwhile fails at once with LOOP_ERROR (code "loop", one sentence, errText turns it into
// words), and nothing is sent. Why 30: a page asks a tool at most twice a minute by itself (the watches poll every
// 30–60 s) and a person cannot press a button 30 times in a minute, while an effect loop fires many times a second
// and reaches 30 within seconds; it is also the server's budget for the tools that cost (rateLimit.ts, 30 a minute),
// so the page stops before the server does. One report per tool per LOOP_REPORT_MS goes through the app's error
// reporting (office-api POST /errors, the App errors page), Sentry-style: the first call that opens the breaker, not
// one per refused call. Pure (an injected clock), the same rule as the app's lib/breaker.ts.

export const LOOP_LIMIT = 30;
export const LOOP_OPEN_MS = 60_000;
export const LOOP_REPORT_MS = 600_000;
export const LOOP_ERROR = { code: "loop", message: "This screen asked the server too often · try again in a minute" } as const;

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

/** The one report's text: which tool, how often, where. */
export function loopReportMessage(endpoint: string, calls: number): string {
  return `Loop: ${endpoint} asked ${calls} times in a minute; stopped for a minute`;
}
