import { describe, expect, it } from "vitest";
import type { AvailableDriver } from "../data/types";
import { availabilityArgs, defaultVehicle, driverLine, driverTone, driverVehicle, floorTo5, licenceTone, rankedRows } from "./availabilityLogic";

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

describe("Who's available, Phase 7 (§3, §10)", () => {
  it("passes the first stop for the best match: a pin, else a place's name", () => {
    expect(availabilityArgs("2026-10-17", "09:00", "", "", "", { lat: 7.48, lng: 80.36 })).toEqual({ at: "2026-10-17 09:00", lat: 7.48, lng: 80.36 });
    expect(availabilityArgs("2026-10-17", "09:00", "", "", "", { place: " Kurunegala site " })).toEqual({ at: "2026-10-17 09:00", first_stop: "Kurunegala site" });
    expect(availabilityArgs("2026-10-17", "09:00", "", "", "", null)).toEqual({ at: "2026-10-17 09:00" });
  });
  it("looks from the leave-by rounded down to 5 minutes, so a plan that moves by a minute does not ask again", () => {
    expect([floorTo5("07:24"), floorTo5("07:20"), floorTo5("07:29"), floorTo5("")]).toEqual(["07:20", "07:20", "07:25", ""]);
    expect(availabilityArgs("2026-10-17", floorTo5("07:23"))).toEqual(availabilityArgs("2026-10-17", floorTo5("07:21")));
  });
  it("names the vehicle a driver brings: today's when on duty, else the regular one, else none", () => {
    expect(defaultVehicle({ name: "Kamal Perera", vehicle: { reg_no: "WP CAB-4521", source: "on_duty" } })).toEqual({ reg_no: "WP CAB-4521", why: "Kamal's vehicle today" });
    expect(defaultVehicle({ name: "Kamal Perera", vehicle: { reg_no: "WP KL-1234", source: "regular" } })).toEqual({ reg_no: "WP KL-1234", why: "Kamal's regular vehicle" });
    expect(defaultVehicle({ name: "Kamal Perera" })).toBeNull();
    expect(driverVehicle(null, { name: "Nuwan Silva", current_vehicle: "WP PH-2087 · Toyota Axio" })).toEqual({ reg_no: "WP PH-2087", why: "Nuwan's vehicle today" });
    expect(driverVehicle(null, { name: "Nuwan Silva" })).toBeNull();
  });
  it("puts the ranked drivers first in their order, then the rest as the server sorted them", () => {
    const rows = [{ ...base, name: "A" }, { ...base, name: "B", rank: 2 }, { ...base, name: "C", free: false }, { ...base, name: "D", rank: 1 }];
    expect(rankedRows(rows).map((r) => r.name)).toEqual(["D", "B", "A", "C"]);
  });
});
