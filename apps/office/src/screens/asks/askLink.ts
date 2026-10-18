// Part 3b (H3): the link to the Ask drivers page (/drivers/ask) with what the page that opens it knows: the drivers picked
// (or all the free ones), the trip's day and times, the task or the request it is for. Who's available, the Drivers board and
// the answers page build it; the Ask page reads it back.
import type { AskKind } from "../../data/types";

export interface AskLinkParams {
  kind?: AskKind;
  /** Usernames. */
  drivers?: string[];
  allFree?: boolean;
  /** YYYY-MM-DD, HH:MM, HH:MM. */
  date?: string;
  from?: string;
  to?: string;
  task?: string;
  request?: string;
}

const KINDS: readonly AskKind[] = ["free_for_trip", "office_time", "where_now"];

export function askLink(p: AskLinkParams = {}): string {
  const q = new URLSearchParams();
  if (p.kind) q.set("kind", p.kind);
  if (p.drivers?.length) q.set("drivers", p.drivers.join(","));
  if (p.allFree) q.set("all_free", "1");
  if (p.date) q.set("date", p.date);
  if (p.from) q.set("from", p.from);
  if (p.to) q.set("to", p.to);
  if (p.task) q.set("task", p.task);
  if (p.request) q.set("request", p.request);
  const s = q.toString();
  return s ? `/drivers/ask?${s}` : "/drivers/ask";
}

export function readAskLink(q: Pick<URLSearchParams, "get">): AskLinkParams {
  const kind = q.get("kind");
  const time = (v: string | null) => (v && /^([01]\d|2[0-3]):[0-5]\d$/.test(v) ? v : undefined);
  const date = q.get("date");
  return {
    kind: KINDS.includes(kind as AskKind) ? (kind as AskKind) : undefined,
    drivers: (q.get("drivers") ?? "").split(",").map((d) => d.trim()).filter(Boolean),
    allFree: q.get("all_free") === "1",
    date: date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : undefined,
    from: time(q.get("from")),
    to: time(q.get("to")),
    task: q.get("task") ?? undefined,
    request: q.get("request") ?? undefined,
  };
}
