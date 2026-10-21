import { assertEquals } from "jsr:@std/assert";
import { attendanceOf } from "./board.ts";

const day = "2026-10-21T00:00:00+05:30";
const at = (hm: string) => new Date(`2026-10-21T${hm}:00+05:30`).toISOString();

Deno.test("today's attendance from the duty sessions", () => {
  assertEquals(attendanceOf([{ started_at: at("07:12"), ended_at: null }], false, day), { state: "on_duty", started: "07:12" });
  assertEquals(
    attendanceOf([{ started_at: at("07:12"), ended_at: at("12:00") }, { started_at: at("13:00"), ended_at: at("17:40") }], false, day),
    { state: "finished", started: "07:12", finished: "17:40" },
  );
  assertEquals(attendanceOf([], true, day), { state: "on_leave" });
  assertEquals(attendanceOf([], false, day), { state: "not_started" });
  // A session open since last night counts from midnight.
  assertEquals(attendanceOf([{ started_at: new Date("2026-10-20T22:00:00+05:30").toISOString(), ended_at: null }], false, day), {
    state: "on_duty",
    started: "00:00",
  });
});
