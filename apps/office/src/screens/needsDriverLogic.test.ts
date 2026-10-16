import { describe, expect, it } from "vitest";
import type { NeedsDriverTask } from "../data/types";
import { bestLine, findDriverPath, NEEDS_DRIVER_LIST, needsDriverCount, sortNeedsDriver, whenTone } from "./needsDriverLogic";

const task = (task_id: string, minutes_to_start: number): NeedsDriverTask => ({
  task_id, start: "09:00", title: "Team drop", driver: "Kamal Silva", kind: "declined", reason_text: "Vehicle problem",
  line: "Kamal declined · Vehicle problem", minutes_to_start, when: `in ${minutes_to_start} min`,
});

describe("tasks that need a driver", () => {
  it("lead to the change page with the driver first, and the block to the filtered board", () => {
    expect(findDriverPath("t1")).toBe("/tasks/t1/edit?driver=1");
    expect(NEEDS_DRIVER_LIST).toBe("/tasks?filter=needs_driver");
    expect(needsDriverCount(1)).toBe("1 task needs a driver");
    expect(needsDriverCount(3)).toBe("3 tasks need a driver");
  });
  it("the time to the start is red when late or within the hour, amber within 4 hours", () => {
    expect(whenTone(-18)).toBe("bad");
    expect(whenTone(42)).toBe("bad");
    expect(whenTone(90)).toBe("warn");
    expect(whenTone(600)).toBe("");
  });
  it("names the best match with the vehicle they would take, the soonest task first", () => {
    expect(bestLine({ name: "Nuwan Perera", vehicle: { reg_no: "WP CAB-4521", source: "on_duty" }, why: "On duty" })).toBe("Best match: Nuwan Perera · WP CAB-4521");
    expect(bestLine({ name: "Nuwan Perera", why: "On duty" })).toBe("Best match: Nuwan Perera");
    expect(bestLine(undefined)).toBe("");
    expect(sortNeedsDriver([task("b", 300), task("a", -5)]).map((t) => t.task_id)).toEqual(["a", "b"]);
    expect(sortNeedsDriver(undefined)).toEqual([]);
  });
});
