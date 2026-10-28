// The site's own error report (Round 48): what the app's crash reporting sends (lib/crash.ts reportCrash), from the
// web: one row in app_errors through office-api POST /errors with the person's session, never waited for, never an
// error of its own. Used by the circuit breaker (transport/breaker.ts); the body is appErrors.ts APP_ERROR_INPUT.

export interface LoopReport {
  message: string;
  screen?: string;
}

export function reportBody(r: LoopReport): Record<string, unknown> {
  return {
    message: r.message.slice(0, 600),
    screen: (r.screen ?? (typeof location !== "undefined" ? location.pathname : "")).slice(0, 200),
    side: "office",
    fatal: false,
    app_version: `web ${typeof __BUILD__ === "string" ? __BUILD__ : ""}`.trim(),
    at: new Date().toISOString(),
  };
}

/** Posts the report; a report that does not get through is dropped. */
export function sendReport(base: string, token: string, body: Record<string, unknown>, fetchFn: typeof fetch): void {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 5_000);
    fetchFn(`${base}/errors`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    }).then(() => clearTimeout(timer), () => clearTimeout(timer));
  } catch {
    /* never an error of its own */
  }
}
