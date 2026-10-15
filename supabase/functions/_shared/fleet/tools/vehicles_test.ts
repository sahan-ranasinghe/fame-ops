// The availability line of a vehicle (list_vehicles), pure.
import { assertEquals } from "@std/assert";
import { availabilityOf } from "./vehicles.ts";

// 14 Oct 2026 10:00 Colombo
const now = new Date("2026-10-14T04:30:00Z");
const task = (over: Partial<Parameters<typeof availabilityOf>[1][number]>) => ({
  status: "assigned",
  start_at: "2026-10-14T06:30:00Z",
  end_by: null,
  ...over,
});

Deno.test("in the garage beats everything", () => {
  assertEquals(availabilityOf(true, [task({ status: "in_progress" })], now), {
    availability: "In garage",
  });
});

Deno.test("a running task: the live ETA when there is one ahead, else the planned end, else no end time", () => {
  assertEquals(
    availabilityOf(false, [
      task({
        status: "in_progress",
        end_by: "2026-10-14T08:00:00Z",
        final_eta_at: "2026-10-14T07:40:00Z",
      }),
    ], now),
    {
      availability: "On a task · back ~13:10 (live)",
      back_at: "13:10",
      back_source: "live",
    },
  );
  assertEquals(
    availabilityOf(false, [
      task({
        status: "in_progress",
        end_by: "2026-10-14T08:00:00Z",
        final_eta_at: "2026-10-14T04:00:00Z",
      }),
    ], now),
    {
      availability: "On a task · back ~13:30 (planned)",
      back_at: "13:30",
      back_source: "planned",
    },
  );
  assertEquals(availabilityOf(false, [task({ status: "in_progress" })], now), {
    availability: "On a task · end time not set",
  });
});

Deno.test("booked later today, booked but not started, free", () => {
  assertEquals(
    availabilityOf(false, [
      task({ start_at: "2026-10-14T08:30:00Z" }),
      task({ start_at: "2026-10-14T06:30:00Z" }),
    ], now),
    {
      availability: "Booked later today · 12:00",
    },
  );
  assertEquals(
    availabilityOf(false, [task({ start_at: "2026-10-14T03:30:00Z" })], now),
    {
      availability: "Booked · 09:00 (not started yet)",
    },
  );
  assertEquals(
    availabilityOf(false, [task({ start_at: "2026-10-15T03:30:00Z" })], now),
    { availability: "Free" },
    "tomorrow's booking does not count",
  );
  assertEquals(availabilityOf(false, [], now), { availability: "Free" });
});
