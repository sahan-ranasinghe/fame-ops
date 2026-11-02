// Office mode: a copy of apps/office/src/transport/snapHold.ts, written by scripts/shared-logic.mjs --write. Never edit it here: edit
// the site's file and run the script (the app's test:shared-logic and the site's sharedLogic test fail until you do).

// The asker's own copy of a route's snapped line (the snap cost fix, 2 November 2026). The server keeps Google's lines only in
// one isolate's memory for 30 minutes, and Supabase changes isolates every few minutes, so a page's 60-second refresh kept
// paying for the whole day again on a cold one. Now the page holds the line it was answered and each later call of the same
// route says so (snap_held): the server sends and answers only what came after it (snapped.from), and this file adds that to
// the line, so every screen still gets one whole answer. Memory only, gone with the page: nothing of Google's is stored.
// Pure, no import: the site's transport and Office mode's client use the same file (scripts/shared-logic.mjs).

interface SnapAnswer {
  route_snapped?: { columns: string[]; points: (string | number | null)[][] };
  snapped?: { from?: string; held?: string };
}

interface Held {
  token: string;
  columns: string[];
  points: (string | number | null)[][];
}

/** Routes held at once: a page shows a few; the oldest goes first. */
const MAX_HELD = 6;

/** Which route a call asks for: the same driver and day, or task, at the same detail; whichever screen asks. */
function keyOf(args: Record<string, unknown>): string {
  const { driver, date, task_id, from, to, line_tolerance_m, max_line_points } = args;
  return JSON.stringify([driver, date, task_id, from, to, line_tolerance_m, max_line_points]);
}

export class SnapHolds {
  private held = new Map<string, Held>();

  /** The call's arguments: with the token of the line held for this route. */
  ask(tool: string, args: Record<string, unknown>): Record<string, unknown> {
    if (tool !== "driver_route" || args.snap !== true) return args;
    const held = this.held.get(keyOf(args));
    return held ? { ...args, snap_held: held.token } : args;
  }

  /** The answer the screens read: the line held up to snapped.from and what the server sent after it; the new line is held. */
  answer<T>(tool: string, args: Record<string, unknown>, result: T): T {
    if (tool !== "driver_route" || args.snap !== true) return result;
    const key = keyOf(args);
    const answer = result as SnapAnswer;
    const before = this.held.get(key);
    this.held.delete(key);
    const token = answer?.snapped?.held;
    const fresh = answer?.route_snapped;
    if (!token || !fresh) return result;
    let points = fresh.points;
    const from = answer.snapped?.from;
    // Only the part after a line this page no longer has: shown as it is, and not held, so the next call asks for it whole.
    if (from && !before) return result;
    if (from && before) {
      const at = before.columns.indexOf("at");
      const upTo = Date.parse(from);
      points = [...before.points.filter((p) => Date.parse(String(p[at])) <= upTo), ...fresh.points];
    }
    this.held.set(key, { token, columns: fresh.columns, points });
    if (this.held.size > MAX_HELD) this.held.delete(this.held.keys().next().value as string);
    return { ...result, route_snapped: { columns: fresh.columns, points } };
  }
}
