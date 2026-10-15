// The "Who's available" chip rules (Phase 6, Part 2), pure.
import { assertEquals } from "@std/assert";
import { type AvailabilityWindow, driverAvailability, type DriverDay, rankAvailability, taskBusy } from "./availability.ts";

// A Colombo day: 2026-10-15. The window asked: 09:00–12:00.
const day = "2026-10-15";
const w: AvailabilityWindow = { from: "2026-10-15T03:30:00.000Z", to: "2026-10-15T06:30:00.000Z", day_end: "2026-10-15T18:30:00.000Z" };
const base: DriverDay = {
  name: "Nuwan",
  username: "nuwan.p",
  licence_expiry: "2027-01-01",
  on_duty_since: null,
  off_duty_since: null,
  tasks: [],
  running: null,
  accepted_today: 0,
  declined_today: 0,
};

Deno.test("on duty, nothing booked: free, 'On duty since 07:12'", () => {
  const row = driverAvailability({ ...base, on_duty_since: "2026-10-15T01:42:00.000Z" }, w, day);
  assertEquals(row.state, "on_duty");
  assertEquals(row.status_text, "On duty since 07:12");
  assertEquals(row.on_duty_since, "07:12");
  assertEquals(row.free, true);
  assertEquals(row.licence, { chip: "ok", expiry: "2027-01-01" });
});

Deno.test("off duty since this morning's end, a task later in the day: free for the window, next task shown", () => {
  const row = driverAvailability(
    {
      ...base,
      off_duty_since: "2026-10-15T02:10:00.000Z",
      tasks: [{ title: "Airport run", status: "assigned", start_at: "2026-10-15T07:30:00.000Z", end_by: "2026-10-15T09:00:00.000Z" }],
    },
    w,
    day,
  );
  assertEquals(row.state, "off_duty");
  assertEquals(row.status_text, "Off duty since 07:40");
  assertEquals(row.free, true);
  assertEquals(row.next_task_start, "13:00");
  assertEquals(row.busy_with, undefined);
});

Deno.test("a task overlapping the window makes the driver busy, with the task named", () => {
  const row = driverAvailability(
    {
      ...base,
      on_duty_since: "2026-10-15T01:00:00.000Z",
      tasks: [{ title: "Team drop", status: "assigned", start_at: "2026-10-15T05:00:00.000Z", end_by: "2026-10-15T08:00:00.000Z" }],
    },
    w,
    day,
  );
  assertEquals(row.free, false);
  assertEquals(row.busy_with, "Team drop 10:30–13:30");
});

Deno.test("a task with no end time runs to the end of its day", () => {
  const t = { start_at: "2026-10-15T00:30:00.000Z", end_by: null };
  assertEquals(taskBusy(t, w), true);
  assertEquals(taskBusy(t, { ...w, from: "2026-10-15T17:00:00.000Z", to: null }), true);
  assertEquals(taskBusy({ start_at: "2026-10-15T07:00:00.000Z", end_by: null }, w), false);
});

Deno.test("on a task now: the chip says until when, live before planned", () => {
  const running = {
    title: "Site visit",
    status: "in_progress",
    start_at: "2026-10-15T02:00:00.000Z",
    end_by: null,
    ends_planned: "2026-10-15T05:00:00.000Z",
    ends_live: "2026-10-15T05:10:00.000Z",
  };
  const row = driverAvailability({ ...base, on_duty_since: "2026-10-15T01:55:00.000Z", running, tasks: [running] }, w, day);
  assertEquals(row.state, "on_task");
  assertEquals(row.status_text, "On a task until ~10:40 (live)");
  assertEquals(row.current_task, { title: "Site visit", ends_planned: "10:30", ends_live: "10:40" });
  assertEquals(row.free, false);
  const planned = driverAvailability({ ...base, running: { ...running, ends_live: null } }, w, day);
  assertEquals(planned.status_text, "On a task until ~10:30 (planned)");
  const unknown = driverAvailability({ ...base, running: { ...running, ends_live: null, ends_planned: null } }, w, day);
  assertEquals(unknown.status_text, "On a task · end time not set");
});

Deno.test("the licence chip and the day's counts travel with the row; no licence = not set", () => {
  const row = driverAvailability({ ...base, licence_expiry: null, accepted_today: 2, declined_today: 1 }, w, day);
  assertEquals(row.licence, { chip: "not set", expiry: undefined });
  assertEquals([row.accepted_today, row.declined_today], [2, 1]);
  assertEquals(driverAvailability({ ...base, licence_expiry: "2026-10-01" }, w, day).licence.chip, "red");
});

Deno.test("free drivers first, on duty before off duty, then by name", () => {
  const rows = [
    driverAvailability({ ...base, name: "Zara", on_duty_since: null }, w, day),
    driverAvailability({ ...base, name: "Amal", on_duty_since: "2026-10-15T01:00:00.000Z" }, w, day),
    driverAvailability(
      {
        ...base,
        name: "Busy",
        on_duty_since: "2026-10-15T01:00:00.000Z",
        tasks: [{ title: "X", status: "assigned", start_at: w.from, end_by: w.to }],
      },
      w,
      day,
    ),
    driverAvailability({ ...base, name: "Bimal", on_duty_since: null }, w, day),
  ];
  assertEquals(rankAvailability(rows).map((r) => r.name), ["Amal", "Bimal", "Zara", "Busy"]);
});
