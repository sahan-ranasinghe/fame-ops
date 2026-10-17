import { describe, expect, it } from "vitest";
import type { Availability, AvailableDriver } from "../data/types";
import { availabilityArgs, defaultVehicle, driverLine, driverTone, driverVehicle, floorTo5, licenceTone, rankedRows, steadyAvailability, withPicked } from "./availabilityLogic";

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
    expect(defaultVehicle({ name: "Kamal Perera", vehicle: { reg_no: "WP CAB-4521", source: "on_duty" } }, [])).toEqual({ reg_no: "WP CAB-4521", why: "Kamal's vehicle today" });
    expect(defaultVehicle({ name: "Kamal Perera", vehicle: { reg_no: "WP KL-1234", source: "regular" } }, [])).toEqual({ reg_no: "WP KL-1234", why: "Kamal's regular vehicle" });
    expect(defaultVehicle({ name: "Kamal Perera" }, [])).toBeNull();
    expect(driverVehicle(null, { name: "Nuwan Silva", current_vehicle: "WP PH-2087 · Toyota Axio" }, [])).toEqual({ reg_no: "WP PH-2087", why: "Nuwan's vehicle today" });
    expect(driverVehicle(null, { name: "Nuwan Silva" }, [])).toBeNull();
  });
  it("puts the ranked drivers first in their order, then the rest as the server sorted them", () => {
    const rows = [{ ...base, name: "A" }, { ...base, name: "B", rank: 2 }, { ...base, name: "C", free: false }, { ...base, name: "D", rank: 1 }];
    expect(rankedRows(rows).map((r) => r.name)).toEqual(["D", "B", "A", "C"]);
  });
});

describe("Who's available, hotfix (17 October 2026)", () => {
  it("says the full name when two drivers share a first name", () => {
    const names = ["Test Driver", "Test Driver 2", "Kanishka"];
    expect(defaultVehicle({ name: "Test Driver", vehicle: { reg_no: "CAP-2207", source: "on_duty" } }, names)).toEqual({ reg_no: "CAP-2207", why: "Test Driver's vehicle today" });
    expect(defaultVehicle({ name: "Test Driver 2", vehicle: { reg_no: "TEST-0002", source: "regular" } }, names)).toEqual({ reg_no: "TEST-0002", why: "Test Driver 2's regular vehicle" });
    expect(defaultVehicle({ name: "Kanishka", vehicle: { reg_no: "TEST-0001", source: "regular" } }, names)).toEqual({ reg_no: "TEST-0001", why: "Kanishka's regular vehicle" });
    expect(driverVehicle(null, { name: "Test Driver", current_vehicle: "CAP-2207 · Suzuki Alto" }, names)).toEqual({ reg_no: "CAP-2207", why: "Test Driver's vehicle today" });
  });

  const answer = (first: "kamal" | "nuwan", extra: Partial<Availability> = {}): Availability => {
    const kamal = { ...base, name: "Kamal Perera", username: "kamal", rank: first === "kamal" ? 1 : 2, vehicle: { reg_no: "WP CAB-4521", source: "on_duty" as const } };
    const nuwan = { ...base, name: "Nuwan Silva", username: "nuwan", rank: first === "nuwan" ? 1 : 2, status_text: first === "nuwan" ? "On duty since 07:15" : "On duty since 07:12" };
    const top = first === "kamal" ? kamal : nuwan;
    return {
      as_of: "17 Oct 09:00",
      window: { from: "Sat 17 Oct 10:00", until: "end of the day", day: "2026-10-17" },
      drivers: [kamal, nuwan, { ...base, name: "Sunil", username: "sunil", state: "off_duty", status_text: "Off duty" }],
      best: { name: top.name, username: top.username, vehicle: top.vehicle, why: `On duty · ${first === "kamal" ? "0.4" : "0.3"} km from the pickup` },
      counts: { free: 3, on_duty: 2, all: 3 },
      vehicles: { groups: { free_pool: [], free_assigned: [], busy: [], in_garage: [] }, drivers_free: [] },
      ...extra,
    };
  };

  it("a refresh with the same drivers in the ranking keeps the order and the best match; the words are fresh", () => {
    const shown = answer("kamal");
    const next = steadyAvailability(shown, answer("nuwan"));
    expect(rankedRows(next.drivers).map((r) => r.username)).toEqual(["kamal", "nuwan", "sunil"]);
    expect(next.best?.username).toBe("kamal");
    expect(next.best?.vehicle?.reg_no).toBe("WP CAB-4521");
    expect(next.drivers.find((r) => r.username === "nuwan")?.status_text).toBe("On duty since 07:15");
    // The same answer again keeps its rows' objects (the store then keeps the whole answer).
    const again = answer("kamal");
    expect(steadyAvailability(shown, again).drivers[0]).toBe(again.drivers[0]);
  });

  it("a driver select keeps the picked driver among its options, even when its list lacks them", () => {
    const list = [{ username: "kamal", name: "Kamal Perera" }];
    expect(withPicked(list, "kamal", "Kamal Perera")).toBe(list);
    expect(withPicked(list, "", undefined)).toBe(list);
    expect(withPicked([], "nuwan", "Nuwan Silva")).toEqual([{ username: "nuwan", name: "Nuwan Silva" }]);
    expect(withPicked(list, "sunil", undefined)).toEqual([...list, { username: "sunil", name: "sunil" }]);
  });

  it("re-ranks on a real move: a driver shown lower is now nearer by more than half a kilometre", () => {
    const at = (kamalKm: number, nuwanKm: number) => {
      const a = answer(kamalKm <= nuwanKm ? "kamal" : "nuwan");
      a.drivers = a.drivers.map((r) => (r.username === "kamal" ? { ...r, km_to_first: kamalKm, match_why: `${kamalKm} km` } : r.username === "nuwan" ? { ...r, km_to_first: nuwanKm, match_why: `${nuwanKm} km` } : r));
      return a;
    };
    const shown = at(0.3, 0.4);
    // GPS wander: Nuwan 0.2 km nearer now. The ranking holds; the held best's words and vehicle are its fresh row's.
    const wander = steadyAvailability(shown, at(0.6, 0.4));
    expect(wander.best?.username).toBe("kamal");
    expect(wander.best?.why).toBe("0.6 km");
    expect(wander.best?.vehicle?.reg_no).toBe("WP CAB-4521");
    expect(rankedRows(wander.drivers).map((r) => r.username)).toEqual(["kamal", "nuwan", "sunil"]);
    // Kamal drives off: Nuwan is 19.6 km nearer. Ranked again.
    const moved = at(20, 0.4);
    expect(steadyAvailability(shown, moved)).toBe(moved);
    expect(moved.best?.username).toBe("nuwan");
    // The first position of the morning: neither had one (ranked by name), now Nuwan has. Ranked again.
    const none = at(0.3, 0.4);
    none.drivers = none.drivers.map((r) => ({ ...r, km_to_first: undefined }));
    const later = at(0.4, 0.3);
    later.drivers = later.drivers.map((r) => (r.username === "kamal" ? { ...r, km_to_first: undefined } : r));
    expect(steadyAvailability(none, later)).toBe(later);
  });

  it("the held best match carries no vehicle its fresh row has lost", () => {
    const shown = answer("kamal");
    const next = answer("nuwan");
    next.drivers = next.drivers.map((r) => (r.username === "kamal" ? { ...r, vehicle: undefined } : r));
    expect(steadyAvailability(shown, next).best?.vehicle).toBeUndefined();
  });

  it("a driver joining or leaving the ranking ranks them all again", () => {
    const shown = answer("kamal");
    const busy = answer("nuwan");
    busy.drivers = busy.drivers.map((r) => (r.username === "kamal" ? { ...r, rank: undefined, free: false, busy_with: "Team drop 10:00–12:00" } : { ...r, rank: r.username === "nuwan" ? 1 : r.rank }));
    const next = steadyAvailability(shown, busy);
    expect(next).toBe(busy);
    expect(next.best?.username).toBe("nuwan");
  });
});
