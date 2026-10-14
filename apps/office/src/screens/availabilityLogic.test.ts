import { describe, expect, it } from "vitest";
import type { AvailableDriver } from "../data/types";
import { availabilityArgs, driverLine, driverTone, licenceTone } from "./availabilityLogic";

const base: AvailableDriver = { name: "Nuwan", username: "nuwan.p", state: "on_duty", status_text: "On duty since 07:12", on_duty_since: "07:12", accepted_today: 0, declined_today: 0, licence: { chip: "ok" }, free: true };

describe("Who's available", () => {
  it("tones: free and on duty is live, on a task amber, off duty grey, busy red", () => {
    expect(driverTone(base)).toBe("live");
    expect(driverTone({ ...base, state: "on_task" })).toBe("warn");
    expect(driverTone({ ...base, state: "off_duty" })).toBe("muted");
    expect(driverTone({ ...base, free: false })).toBe("bad");
  });
  it("one line per driver: the status, what is next or what makes them busy, the day's counts", () => {
    expect(driverLine(base)).toBe("On duty since 07:12");
    expect(driverLine({ ...base, next_task_start: "13:00", accepted_today: 2, declined_today: 1 })).toBe("On duty since 07:12 · next task 13:00 · 2 accepted · 1 declined");
    expect(driverLine({ ...base, free: false, busy_with: "Team drop 10:30–13:30", next_task_start: "15:00" })).toBe("On duty since 07:12 · busy: Team drop 10:30–13:30");
  });
  it("the licence chip tones", () => {
    expect([licenceTone("ok"), licenceTone("orange"), licenceTone("red"), licenceTone("not set"), licenceTone(undefined)]).toEqual(["ok", "warn", "bad", "muted", "muted"]);
  });
  it("asks availability once the day and time are known; until only when later than the time", () => {
    expect(availabilityArgs("", "09:00")).toBeNull();
    expect(availabilityArgs("2026-10-17", "9:00")).toBeNull();
    expect(availabilityArgs("2026-10-17", "09:00")).toEqual({ at: "2026-10-17 09:00" });
    expect(availabilityArgs("2026-10-17", "09:00", "12:00", "van", "4")).toEqual({ at: "2026-10-17 09:00", until: "12:00", need_type: "van", pax: 4 });
    expect(availabilityArgs("2026-10-17", "09:00", "08:00")).toEqual({ at: "2026-10-17 09:00" });
  });
});
