import { describe, expect, it } from "vitest";
import type { LiveDriver, VehicleCard } from "../data/types";
import { canMove, currentChoice, moveHint, moveInput, moveRows, moveSentence, NO_VEHICLE, notMovable, samePlate } from "./moveLogic";

const v = (reg_no: string, extra: Partial<VehicleCard> = {}): VehicleCard => ({ reg_no, make_model: "Toyota HiAce", seats: 14, status: "Available", availability: "Free", ...extra });
const vehicles: VehicleCard[] = [
  v("WP CAB-1111", { status: "On a task", availability: "On a task · back ~14:30 (planned)", back_at: "14:30", held_by: "Nuwan Perera", held_since: "09:10" }),
  v("WP CAB-2222", { status: "In garage", availability: "In garage" }),
  v("WP CAB-3333", { held_by: "Sunil Fernando", held_since: "07:55" }),
  v("WP CAB-4521", { held_by: "Kamal Silva", held_since: "08:40" }),
  v("WP CAB-5555", { availability: "Booked later today · 15:00" }),
  v("WP CAB-6666", { make_model: undefined, seats: undefined }),
  v("WP OLD-0001", { active: false }),
];
const live: LiveDriver[] = [
  { driver: "Nuwan Perera", username: "nuwan", state: "sharing", duty: "on_task", vehicle: "WP CAB-1111 · Toyota HiAce", task: "Team drop" },
  { driver: "Kamal Silva", username: "kamal", state: "sharing", duty: "on_duty", vehicle: "WP CAB-4521 · Toyota HiAce" },
];
const kamal = { name: "Kamal Silva", vehicle: "WP CAB-4521 · Toyota HiAce" };

describe("the vehicles a driver on duty can be moved to", () => {
  it("lists every active vehicle: the current one first, then free, held by someone, in garage, on a task", () => {
    const rows = moveRows(vehicles, kamal, live);
    expect(rows.map((r) => r.reg_no)).toEqual(["WP CAB-4521", "WP CAB-5555", "WP CAB-6666", "WP CAB-3333", "WP CAB-2222", "WP CAB-1111"]);
    expect(rows[0]).toMatchObject({ current: true, disabled: false, note: "Current vehicle · since 08:40", what: "Toyota HiAce · 14 seats" });
    expect(rows[1]).toMatchObject({ note: "Free · Booked later today · 15:00", tone: "" });
    expect(rows[2]).toMatchObject({ note: "Free", what: "" });
    expect(rows[3]).toMatchObject({ note: "With Sunil Fernando now · since 07:55", tone: "warn", held_by: "Sunil Fernando", disabled: false });
    expect(rows[4]).toMatchObject({ note: "In garage", tone: "warn", disabled: false });
    expect(rows[5]).toMatchObject({ note: "On a task with Nuwan Perera · back ~14:30", tone: "bad", disabled: true });
  });
  it("finds the current vehicle by the holder too, and plates match without spaces or dashes", () => {
    expect(samePlate("WP CAB-4521 · Toyota HiAce", "wpcab4521")).toBe(true);
    expect(samePlate(undefined, "WP CAB-4521")).toBe(false);
    const rows = moveRows(vehicles, { name: "Kamal Silva" }, live);
    expect(currentChoice(rows)).toBe("WP CAB-4521");
    expect(currentChoice(moveRows(vehicles, { name: "Ruwan" }, live))).toBe(NO_VEHICLE);
  });
  it("a vehicle on a task with no live card for its driver still says why it can't be picked", () => {
    const rows = moveRows([vehicles[0]], kamal, []);
    expect(rows[0]).toMatchObject({ note: "On a task · back ~14:30", disabled: true });
  });
});

describe("Move: only a change, never onto a running task", () => {
  const rows = moveRows(vehicles, kamal, live);
  it("is offered for another vehicle or No vehicle, not for the current one or one on a task", () => {
    expect(canMove(rows, "WP CAB-4521")).toBe(false);
    expect(canMove(rows, "WP CAB-1111")).toBe(false);
    expect(canMove(rows, "WP CAB-3333")).toBe(true);
    expect(canMove(rows, "WP CAB-2222")).toBe(true);
    expect(canMove(rows, NO_VEHICLE)).toBe(true);
    expect(canMove(rows, "WP NOPE-0000")).toBe(false);
    expect(canMove(moveRows(vehicles, { name: "Ruwan" }, live), NO_VEHICLE)).toBe(false);
  });
  it("says what Move will do", () => {
    expect(moveHint(rows, "WP CAB-4521", "Kamal")).toBe("Kamal is on WP CAB-4521 now: pick another vehicle, or No vehicle.");
    expect(moveHint(rows, "WP CAB-3333", "Kamal")).toBe("Sunil Fernando no longer holds WP CAB-3333 and is told.");
    expect(moveHint(rows, "WP CAB-5555", "Kamal")).toBe("Kamal takes WP CAB-5555.");
    expect(moveHint(rows, NO_VEHICLE, "Kamal")).toBe("Kamal stays on duty without a vehicle.");
    expect(moveHint(rows, "WP CAB-1111", "Kamal")).toBe("WP CAB-1111 is on another driver's running task.");
    expect(moveHint(moveRows(vehicles, { name: "Ruwan" }, live), NO_VEHICLE, "Ruwan")).toBe("Ruwan has no vehicle now: pick one.");
  });
  it("sends the username and the plate, or null for no vehicle", () => {
    expect(moveInput("kamal", "WP CAB-3333")).toEqual({ driver: "kamal", vehicle: "WP CAB-3333" });
    expect(moveInput("kamal", NO_VEHICLE)).toEqual({ driver: "kamal", vehicle: null });
  });
  it("the sentence after Move", () => {
    expect(moveSentence({ driver: "Kamal Silva", vehicle: "WP CAB-3333 · Toyota HiAce", taken_from: "Sunil Fernando", note: "Sunil Fernando no longer holds it and was told." }))
      .toBe("Kamal Silva is now on WP CAB-3333. Sunil Fernando was told.");
    expect(moveSentence({ driver: "Kamal Silva", vehicle: "WP CAB-5555" })).toBe("Kamal Silva is now on WP CAB-5555.");
    expect(moveSentence({ driver: "Kamal Silva", vehicle: "none" })).toBe("Kamal Silva now has no vehicle.");
  });
});

describe("who can be moved", () => {
  it("off duty or on a task: a short explanation instead of the form", () => {
    expect(notMovable(live[1])).toBeUndefined();
    expect(notMovable(live[0])).toBe("Nuwan Perera is on a task with WP CAB-1111. A driver can't be moved while a task is in progress.");
    expect(notMovable({ driver: "Ruwan", username: "ruwan", state: "not_sharing", duty: "off_duty" })).toBe("Ruwan is off duty. The vehicle is chosen on the phone at Start work.");
  });
});
