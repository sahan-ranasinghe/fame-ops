// Hotfix O2-H2, Part 1c: what a crash shows and what it reports, the rules only (pure: no react-native, tested by
// scripts/test-crash.ts). The details are what Sahan screenshots ("Show details"): the error's message, the screen, the
// app version, the update id, the runtime and the first lines of the stack. Nothing personal and no key may be in them:
// an e-mail, a phone number, a token, a long number or an id-like string is replaced before it is shown or sent.

export interface CrashContext {
  /** The route the error happened on ("/office/trip/review"). */
  screen: string;
  /** "1.3.0+<update id>" (heartbeat's appVersionLabel). */
  appVersion: string;
  updateId: string | null;
  runtime: string | null;
  side: 'office' | 'driver' | 'none';
}

export interface CrashDetails extends CrashContext {
  message: string;
  stack: string[];
  /** fatal: the screen broke (the crash screen); not fatal: a snackbar. */
  fatal: boolean;
  at: string;
}

/** How many stack lines are kept (enough to find the file and line, short enough for a screenshot). */
export const STACK_LINES = 8;

const PATTERNS: [RegExp, string][] = [
  [/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}(\.[A-Za-z0-9_-]+)?/g, '<token>'],
  [/\bsb_(publishable|secret)_[A-Za-z0-9_-]+/g, '<key>'],
  [/\bAIza[0-9A-Za-z_-]{20,}/g, '<key>'],
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '<email>'],
  [/(\+?94[\s-]?|\b0)7\d[\s-]?\d{3}[\s-]?\d{4}\b/g, '<phone>'],
  [/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '<id>'],
  [/\b\d{9,}\b/g, '<number>'],
  [/([?&](token|key|apikey|access_token)=)[^&\s]+/gi, '$1<redacted>'],
];

/** The text with anything personal or secret replaced. */
export function scrub(text: string): string {
  let s = String(text ?? '');
  for (const [re, to] of PATTERNS) s = s.replace(re, to);
  return s;
}

/** The first stack lines, each scrubbed and trimmed (the app's own frames first when there are any). */
export function stackLines(stack: string | undefined | null, n = STACK_LINES): string[] {
  const lines = String(stack ?? '').split('\n').map((l) => l.trim()).filter(Boolean);
  const body = lines[0] && !/^\s*at\s|@/.test(lines[0]) ? lines.slice(1) : lines;
  return body.slice(0, n).map((l) => scrub(l).slice(0, 160));
}

/** An error of any kind as a message (a thrown string, an object with message, an Error). */
export function messageOf(e: unknown): string {
  if (e instanceof Error) return e.message || e.name;
  if (typeof e === 'string') return e;
  if (e && typeof e === 'object' && 'message' in e && typeof (e as { message: unknown }).message === 'string') return (e as { message: string }).message;
  try {
    return JSON.stringify(e).slice(0, 300);
  } catch {
    return String(e);
  }
}

export function crashDetails(e: unknown, ctx: CrashContext, fatal: boolean, now = new Date()): CrashDetails {
  return {
    ...ctx,
    screen: scrub(ctx.screen),
    message: scrub(messageOf(e)).slice(0, 300),
    stack: stackLines(e instanceof Error ? e.stack : (e as { stack?: string } | null)?.stack),
    fatal,
    at: now.toISOString(),
  };
}

/** The block "Show details" shows and Copy shares, one fact a line. */
export function detailsText(d: CrashDetails): string {
  return [
    `Error: ${d.message}`,
    `Screen: ${d.screen || '?'}`,
    `App: ${d.appVersion}`,
    `Update: ${d.updateId ?? 'built-in'}`,
    `Runtime: ${d.runtime ?? '?'}`,
    `Side: ${d.side}`,
    `Time: ${d.at}`,
    ...(d.stack.length ? ['Stack:', ...d.stack] : []),
  ].join('\n');
}

/** The report the server keeps (office-api / driver-api POST /errors): the details, nothing else. */
export function reportBody(d: CrashDetails): Record<string, unknown> {
  return { app_version: d.appVersion, update_id: d.updateId, runtime: d.runtime, screen: d.screen, message: d.message, stack: d.stack.join('\n'), side: d.side, fatal: d.fatal, at: d.at };
}

/** A soft error's snackbar: at most one every 30 s for the same message, and one every 10 s at all (a background promise
 *  that keeps failing, or the splash's own promises after Reload app, must not keep a driver's screen red). */
export function shouldShowSoft(last: { key: string; at: number } | null, d: Pick<CrashDetails, 'message'>, now: number): boolean {
  if (!last) return true;
  if (now - last.at < 10_000) return false;
  return last.key !== d.message || now - last.at > 30_000;
}

/** The route as its pattern, never the person or the id in it: ["office", "driver", "[username]"] → "/office/driver/[username]". */
export function screenOf(segments: readonly string[]): string {
  return `/${segments.filter(Boolean).join('/')}`;
}

/** The same error twice within a minute is reported once (a loop of renders must not flood the server). */
export function shouldReport(last: { key: string; at: number } | null, d: Pick<CrashDetails, 'message' | 'screen'>, now: number): boolean {
  const key = `${d.screen}|${d.message}`;
  return !last || last.key !== key || now - last.at > 60_000;
}
