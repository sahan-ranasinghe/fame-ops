import { assertEquals } from "@std/assert";
import { driverAvailability, type DriverDay } from "./availability.ts";
import { lastSeenText, lateReportOf, notAvailableNow, overlapping, unavailableText, unavailableWarning, usualStart } from "./presence.ts";

// Colombo is UTC+05:30: 2026-10-20 13:00 Colombo = 07:30Z.
const at = (local: string) => new Date(`${local}:00+05:30`).toISOString();
const entry = (part: string, from: string, to: string, reason = "half_day") => ({
  id: "u1",
  employee_id: "e1",
  starts_at: at(from),
  ends_at: at(to),
  part,
  reason,
});

Deno.test("an entry in words: a day, several days, the morning, the afternoon, two times", () => {
  assertEquals(unavailableText(entry("full_day", "2026-10-20T00:00", "2026-10-21T00:00", "leave")), "Not available · leave, all day");
  assertEquals(
    unavailableText(entry("full_day", "2026-10-20T00:00", "2026-10-23T00:00", "leave")),
    "Not available · leave until Thu 22 Oct",
  );
  assertEquals(unavailableText(entry("morning", "2026-10-20T00:00", "2026-10-20T13:00")), "Not available · half day, back 13:00");
  assertEquals(
    unavailableText(entry("afternoon", "2026-10-20T13:00", "2026-10-21T00:00", "personal")),
    "Not available · personal, from 13:00",
  );
  assertEquals(unavailableText(entry("hours", "2026-10-20T09:30", "2026-10-20T11:00", "other")), "Not available · other, 09:30–11:00");
});

Deno.test("overlap and the assign warning: then, that day, or nothing", () => {
  const morning = [entry("morning", "2026-10-20T00:00", "2026-10-20T13:00")];
  assertEquals(overlapping(morning, at("2026-10-20T12:00"), at("2026-10-20T14:00")).length, 1);
  assertEquals(overlapping(morning, at("2026-10-20T13:00"), at("2026-10-20T14:00")).length, 0);
  const day = { from: at("2026-10-20T00:00"), to: at("2026-10-21T00:00") };
  assertEquals(
    unavailableWarning("Kamal Perera", morning, at("2026-10-20T09:00"), at("2026-10-20T11:00"), day.from, day.to),
    { text: "Kamal is not available then · half day, back 13:00", overlaps: true },
  );
  assertEquals(
    unavailableWarning("Kamal Perera", morning, at("2026-10-20T15:00"), at("2026-10-20T17:00"), day.from, day.to),
    { text: "Kamal is not available that day · half day, back 13:00", overlaps: false },
  );
  assertEquals(unavailableWarning("Kamal", [], at("2026-10-20T09:00"), at("2026-10-20T11:00"), day.from, day.to), null);
});

Deno.test("the status now: back at a time, today, or until a day", () => {
  const now = new Date(at("2026-10-20T10:00"));
  assertEquals(notAvailableNow(entry("morning", "2026-10-20T00:00", "2026-10-20T13:00"), now), "Not available, back 13:00");
  assertEquals(notAvailableNow(entry("full_day", "2026-10-20T00:00", "2026-10-21T00:00", "leave"), now), "Not available today");
  assertEquals(notAvailableNow(entry("full_day", "2026-10-20T00:00", "2026-10-23T00:00", "leave"), now), "Not available until Thu 22 Oct");
});

Deno.test("Who's available: an entry over the window means not free, and the best match skips the driver", () => {
  const d: DriverDay = {
    name: "Kamal",
    username: "kamal",
    licence_expiry: null,
    on_duty_since: at("2026-10-20T07:00"),
    off_duty_since: null,
    tasks: [],
    running: null,
    accepted_today: 0,
    declined_today: 0,
    unavailable: [entry("morning", "2026-10-20T00:00", "2026-10-20T13:00")],
  };
  const w = { from: at("2026-10-20T10:00"), to: at("2026-10-20T12:00"), day_end: at("2026-10-21T00:00") };
  const row = driverAvailability(d, w, "2026-10-20");
  assertEquals([row.free, row.not_available, row.busy_with], [
    false,
    "Not available · half day, back 13:00",
    "Not available · half day, back 13:00",
  ]);
  const later = driverAvailability(d, { ...w, from: at("2026-10-20T14:00"), to: at("2026-10-20T16:00") }, "2026-10-20");
  assertEquals([later.free, later.not_available], [true, undefined]);
});

Deno.test("the usual start: the median first start of each day, from 3 days on", () => {
  assertEquals(usualStart([at("2026-10-19T07:40"), at("2026-10-18T07:50")]), null);
  assertEquals(
    usualStart([
      at("2026-10-19T07:40"),
      at("2026-10-19T13:00"), // a second start the same day does not count
      at("2026-10-18T07:50"),
      at("2026-10-17T08:30"),
    ]),
    "07:50",
  );
  assertEquals(usualStart([at("2026-10-19T07:00"), at("2026-10-18T08:00"), at("2026-10-17T07:30"), at("2026-10-16T08:30")]), "07:45");
});

Deno.test("last seen and the late report", () => {
  const now = new Date(at("2026-10-20T18:00"));
  assertEquals(lastSeenText(at("2026-10-20T17:42"), "Kadawatha", now), "Last seen 17:42 near Kadawatha");
  assertEquals(lastSeenText(at("2026-10-16T17:42"), null, now), "Last seen Fri 16 Oct 17:42");
  assertEquals(lastSeenText(null, "x", now), null);
  assertEquals(lateReportOf({ late_report_min: 15, late_report_at: at("2026-10-20T08:52"), status: "assigned" }, now), {
    min: 15,
    said: "08:52",
    text: "Running late 15 min · said 08:52",
  });
  assertEquals(lateReportOf({ late_report_min: 15, late_report_at: at("2026-10-20T08:52"), status: "completed" }, now), undefined);
});
