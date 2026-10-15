import { assertEquals } from "@std/assert";
import { driverStatus, needsAttention, statusText } from "./status.ts";

const now = new Date("2026-10-12T06:30:00Z"); // 12:00 in Colombo
const ago = (minutes: number) => new Date(now.getTime() - minutes * 60000).toISOString();
const base = { sharing: true, pointAt: null, heartbeatAt: null, locationOn: null, permission: null, locationOffSince: null };

Deno.test("not sharing wins over everything", () => {
  const r = driverStatus({ ...base, sharing: false, pointAt: ago(1), heartbeatAt: ago(1), locationOn: false }, now);
  assertEquals(r.status, "not_sharing");
  assertEquals(statusText(r, now), "Not sharing");
});

Deno.test("a point under 3 minutes old is live, whatever the heartbeat says", () => {
  const r = driverStatus({ ...base, pointAt: ago(2), heartbeatAt: ago(1), locationOn: false, permission: "denied" }, now);
  assertEquals(r.status, "live");
  assertEquals(statusText(r, now), "Live · 2 min");
});

Deno.test("a fresh heartbeat with Location off is location_off since the first off heartbeat", () => {
  const r = driverStatus({
    ...base,
    pointAt: ago(5),
    heartbeatAt: ago(1),
    locationOn: false,
    permission: "always",
    locationOffSince: ago(4),
  }, now);
  assertEquals(r.status, "location_off");
  assertEquals(r.since, ago(4));
  assertEquals(statusText(r, now), "Location off since 11:56");
  assertEquals(r.permissionProblem, false);
});

Deno.test("a fresh heartbeat with the permission not 'always' says so", () => {
  const r = driverStatus({
    ...base,
    pointAt: ago(9),
    heartbeatAt: ago(0),
    locationOn: true,
    permission: "foreground",
    locationOffSince: ago(6),
  }, now);
  assertEquals(r.status, "location_off");
  assertEquals(r.permissionProblem, true);
  assertEquals(statusText(r, now), "Location permission removed since 11:54");
});

Deno.test("no point and no heartbeat for over 3 minutes is no_signal since the last signal", () => {
  const r = driverStatus({ ...base, pointAt: ago(20), heartbeatAt: ago(4), locationOn: true, permission: "always" }, now);
  assertEquals(r.status, "no_signal");
  assertEquals(r.since, ago(4));
  assertEquals(statusText(r, now), "No signal since 11:56");
  assertEquals(r.minutesSinceSignal, 4);
});

Deno.test("an old 'location off' heartbeat is no_signal, not location_off (the phone is not talking)", () => {
  const r = driverStatus({
    ...base,
    pointAt: null,
    heartbeatAt: ago(10),
    locationOn: false,
    permission: "always",
    locationOffSince: ago(30),
  }, now);
  assertEquals(r.status, "no_signal");
});

Deno.test("a fresh heartbeat with Location on but no point for 3 minutes is no_signal (no GPS fix)", () => {
  const r = driverStatus({ ...base, pointAt: ago(7), heartbeatAt: ago(1), locationOn: true, permission: "always" }, now);
  assertEquals(r.status, "no_signal");
  assertEquals(r.since, ago(1));
});

Deno.test("sharing just switched on, nothing yet: no_signal with no since", () => {
  const r = driverStatus(base, now);
  assertEquals(r.status, "no_signal");
  assertEquals(r.since, null);
  assertEquals(statusText(r, now), "No signal");
});

Deno.test("needs attention after 10 minutes of location off or no signal, not before, never when live", () => {
  const off = driverStatus({
    ...base,
    pointAt: ago(15),
    heartbeatAt: ago(1),
    locationOn: false,
    permission: "always",
    locationOffSince: ago(12),
  }, now);
  assertEquals(needsAttention(off, ago(60), now), true);
  const offRecent = driverStatus({
    ...base,
    pointAt: ago(15),
    heartbeatAt: ago(1),
    locationOn: false,
    permission: "always",
    locationOffSince: ago(5),
  }, now);
  assertEquals(needsAttention(offRecent, ago(60), now), false);
  const silent = driverStatus({ ...base, pointAt: ago(11), heartbeatAt: ago(11), locationOn: true, permission: "always" }, now);
  assertEquals(needsAttention(silent, ago(60), now), true);
  const neverSignalled = driverStatus(base, now);
  assertEquals(needsAttention(neverSignalled, ago(11), now), true, "a task that started 11 minutes ago with no signal at all");
  assertEquals(needsAttention(neverSignalled, ago(5), now), false);
  const live = driverStatus({ ...base, pointAt: ago(1) }, now);
  assertEquals(needsAttention(live, ago(60), now), false);
});

Deno.test("points the server refused are on the status line, whatever the status", () => {
  const live = driverStatus({ ...base, pointAt: ago(1), rejectedPoints: 500 }, now);
  assertEquals(statusText(live, now), "Live · 1 min · 500 points refused");
  const quiet = driverStatus({ ...base, pointAt: ago(20), heartbeatAt: ago(20), rejectedPoints: 1 }, now);
  assertEquals(
    statusText(quiet, now),
    `No signal since ${
      new Date(ago(20)).toLocaleTimeString("en-GB", { timeZone: "Asia/Colombo", hour: "2-digit", minute: "2-digit", hour12: false })
    } · 1 point refused`,
  );
  assertEquals(statusText(driverStatus({ ...base, pointAt: ago(1), rejectedPoints: 0 }, now), now), "Live · 1 min");
});
