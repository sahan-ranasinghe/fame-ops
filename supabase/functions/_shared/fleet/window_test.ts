// Round 48 (item 4): free / busy by the trip's date. The one window rule (tripWindow), its words, and the best-match
// ranking for a trip that does not start soon (rankMatches: free THEN, not on duty NOW). Pure.
import { assertEquals } from "@std/assert";
import { busyPieces, busyText, freeText, rankMatches, startsSoon, taskBusy, tripDayWords, tripWindow, windowWords } from "./availability.ts";

// Colombo Thu 29 Oct 2026: 09:00 = 03:30Z; the day ends 2026-10-29T18:30:00.000Z.
const start = "2026-10-29T03:30:00.000Z";
const dayEnd = "2026-10-29T18:30:00.000Z";

Deno.test("tripWindow: the end time first, else the plan's end, else the rest of the trip's day", () => {
  const byEnd = tripWindow({ start, endBy: "2026-10-29T07:30:00.000Z", plannedEnd: "2026-10-29T06:00:00.000Z" });
  assertEquals([byEnd.to, byEnd.end_source, byEnd.day, byEnd.day_end], ["2026-10-29T07:30:00.000Z", "end_by", "2026-10-29", dayEnd]);
  const byPlan = tripWindow({ start, endBy: null, plannedEnd: "2026-10-29T06:00:00.000Z" });
  assertEquals([byPlan.to, byPlan.end_source], ["2026-10-29T06:00:00.000Z", "plan"]);
  const open = tripWindow({ start, endBy: null, plannedEnd: null });
  assertEquals([open.to, open.end_source], [dayEnd, "day_end"]);
  // An end at or before the start is no end (a stale plan): the next rule stands.
  const stale = tripWindow({ start, endBy: start, plannedEnd: "2026-10-29T02:00:00.000Z" });
  assertEquals(stale.end_source, "day_end");
});

Deno.test("the words: the trip's day from today, the window, the chips", () => {
  assertEquals(tripDayWords("2026-10-29", "2026-10-29"), "today");
  assertEquals(tripDayWords("2026-10-29", "2026-10-28"), "tomorrow");
  assertEquals(tripDayWords("2026-10-29", "2026-10-27"), "Thu 29 Oct");
  assertEquals(windowWords({ from: start, to: "2026-10-29T07:30:00.000Z" }, "2026-10-27"), "Thu 29 Oct 09:00–13:00");
  assertEquals(windowWords({ from: start, to: null }, "2026-10-28"), "tomorrow 09:00–end of day");
  assertEquals(freeText("2026-10-29", "2026-10-27"), "Free Thu 29 Oct");
  assertEquals(freeText("2026-10-29", "2026-10-29"), "Free today");
  const t = { start_at: start, end_by: "2026-10-29T07:30:00.000Z", title: "Team drop" };
  assertEquals(busyText(t), "Busy 09:00–13:00 that day · Team drop");
  assertEquals(busyText({ ...t, end_by: null }), "Busy from 09:00 that day · Team drop");
  assertEquals(busyPieces(t), { busy_from: "09:00", busy_to: "13:00", busy_title: "Team drop" });
  assertEquals(busyPieces({ ...t, end_by: null }), { busy_from: "09:00", busy_title: "Team drop" });
});

Deno.test("taskBusy: the other task runs to its end, else its plan's end, else the end of its day", () => {
  const w = { from: "2026-10-29T06:30:00.000Z", to: "2026-10-29T07:30:00.000Z", day_end: dayEnd }; // 12:00–13:00
  const early = { start_at: start, end_by: null, ends_planned: "2026-10-29T05:00:00.000Z" }; // 09:00, planned to 10:30
  assertEquals(taskBusy(early, w), false);
  assertEquals(taskBusy({ ...early, ends_planned: null }, w), true);
  assertEquals(taskBusy({ ...early, end_by: "2026-10-29T06:45:00.000Z" }, w), true);
});

Deno.test("startsSoon: within two hours of now", () => {
  const now = new Date("2026-10-29T02:00:00.000Z");
  assertEquals(startsSoon("2026-10-29T03:30:00.000Z", now), true);
  assertEquals(startsSoon("2026-10-29T04:30:00.000Z", now), false);
  assertEquals(startsSoon("2026-10-29T01:00:00.000Z", now), true);
});

const rows = [
  { name: "Nimal", username: "nimal", state: "off_duty" as const, free: true, km_to_first: null, tasks_today: 0 },
  { name: "Kamal", username: "kamal", state: "on_duty" as const, free: true, km_to_first: 3.2, tasks_today: 1 },
  { name: "Ruwan", username: "ruwan", state: "on_task" as const, free: true, km_to_first: 0.4, tasks_today: 2 },
  { name: "Sunil", username: "sunil", state: "on_duty" as const, free: false, km_to_first: 0.1, tasks_today: 1 },
];

Deno.test("rankMatches, a trip starting soon: on duty now and free, the nearest first (the rule before)", () => {
  const out = rankMatches(rows, "09:00–13:00", "the pickup", { soon: true, day: "2026-10-29", dayWords: "today" });
  assertEquals(out.map((m) => m.username), ["kamal"]);
  assertEquals(out[0].why, "On duty · free 09:00–13:00 · 3.2 km from the pickup · 1 task today");
  assertEquals(out[0].free_day, undefined);
});

Deno.test("rankMatches, a trip tomorrow: nobody on duty now still ranks; a driver on a running task now but free then is free", () => {
  const out = rankMatches(rows, "09:00–13:00", "the pickup", { soon: false, day: "2026-10-29", dayWords: "tomorrow" });
  // The fewest tasks that day first, then on duty now as the tie-break, then the name; the busy one never.
  assertEquals(out.map((m) => m.username), ["nimal", "kamal", "ruwan"]);
  assertEquals(out[0].why, "Free tomorrow 09:00–13:00 · 0 tasks that day");
  assertEquals(out[1].why, "Free tomorrow 09:00–13:00 · 1 task that day");
  assertEquals(out.map((m) => m.free_day), ["2026-10-29", "2026-10-29", "2026-10-29"]);
  const nobodyOnDuty = rankMatches(rows.map((r) => ({ ...r, state: "off_duty" as const })), "09:00–13:00", "the first stop", { soon: false, dayWords: "Thu 29 Oct" });
  assertEquals(nobodyOnDuty.length, 3);
  assertEquals(nobodyOnDuty[0].why, "Free Thu 29 Oct 09:00–13:00 · 0 tasks that day");
});

Deno.test("rankMatches without options keeps the old rule (on duty now)", () => {
  assertEquals(rankMatches(rows, "09:00–13:00").map((m) => m.username), ["kamal"]);
});
