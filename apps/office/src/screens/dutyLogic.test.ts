import { describe, expect, it } from "vitest";
import { answerFor, clockOut, dutyArgs, emptyText, vehicleLine } from "./dutyLogic";

describe("duty log words", () => {
  it("says how each vehicle was held", () => {
    expect(vehicleLine({ vehicle: "WP CAB-4521 · Toyota HiAce", from: "08:12", to: "12:40", how: "clocked in", ended: "taken over", by: "Kamal Perera", ended_by: "Nuwan Silva" }, "Kamal Perera"))
      .toEqual({ times: "08:12–12:40", how: "clocked in → taken over by Nuwan Silva" });
    // Still held: no end.
    expect(vehicleLine({ vehicle: "WP PH-2087", from: "12:45", how: "changed", by: "Kamal Perera" }, "Kamal Perera"))
      .toEqual({ times: "12:45–now", how: "changed" });
    // The office's move names the person; the server's own cut-off names nobody.
    expect(vehicleLine({ vehicle: "WP PH-2087", from: "09:00", to: "21:00", how: "office", ended: "cut-off", by: "Sahan R.", ended_by: "system" }, "Kamal Perera"))
      .toEqual({ times: "09:00–21:00", how: "the office (Sahan R.) → cut-off" });
    expect(vehicleLine({ vehicle: "WP PH-2087", from: "09:00", to: "10:00", how: "task start", ended: "office", by: "Kamal Perera", ended_by: "Sahan R." }, "Kamal Perera"))
      .toEqual({ times: "09:00–10:00", how: "task start → the office (Sahan R.)" });
    expect(vehicleLine({ vehicle: "WP PH-2087", from: "09:00", to: "10:00", how: "clocked in", ended: "clocked out", by: "system", ended_by: "Kamal Perera" }, "Kamal Perera"))
      .toEqual({ times: "09:00–10:00", how: "clocked in → clocked out" });
  });

  it("says how the period ended", () => {
    expect(clockOut({ clock_out: "on duty" })).toEqual({ onDuty: true });
    expect(clockOut({ clock_out: "17:40", out_how: "driver" })).toEqual({ time: "17:40", how: "by the driver", onDuty: false });
    expect(clockOut({ clock_out: "Fri 16 Oct 08:02", out_how: "office" })).toEqual({ time: "Fri 16 Oct 08:02", how: "by the office", onDuty: false });
    expect(clockOut({ clock_out: "21:00", out_how: "auto at the cut-off" })).toEqual({ time: "21:00", how: "auto at the cut-off", onDuty: false });
  });

  it("knows whether the answer on screen is the one asked for", () => {
    const today = { from: "2026-10-15", to: "2026-10-15" };
    expect(answerFor({ ...today }, today)).toBe(true);
    expect(answerFor({ from: "2026-10-12", to: "2026-10-18" }, today)).toBe(false);
    expect(answerFor({ ...today, driver: "Kamal Perera" }, today)).toBe(false);
    expect(answerFor({ ...today }, { ...today, driver: "kamal" })).toBe(false);
    expect(answerFor({ ...today, driver: "Kamal Perera" }, { ...today, driver: "kamal" })).toBe(true);
    expect(answerFor({ ...today, driver: "Kamal Perera" }, { ...today, driver: "kamal", driverName: "Kamal Perera" })).toBe(true);
    expect(answerFor({ ...today, driver: "Kamal Perera" }, { ...today, driver: "nuwan", driverName: "Nuwan Silva" })).toBe(false);
  });

  it("says an empty log in words", () => {
    expect(emptyText({ from: "2026-10-15", to: "2026-10-15" }, "2026-10-15")).toBe("Nobody has started work today.");
    expect(emptyText({ from: "2026-10-15", to: "2026-10-15", driver: "Kamal Perera" }, "2026-10-15")).toBe("Kamal Perera has not started work today.");
    expect(emptyText({ from: "2026-10-12", to: "2026-10-18" }, "2026-10-15")).toBe("Nobody was on duty (Mon 12 Oct – Sun 18 Oct 2026).");
    expect(emptyText({ from: "2026-10-14", to: "2026-10-14", driver: "Kamal Perera" }, "2026-10-15")).toBe("Kamal Perera was not on duty (Wed 14 Oct 2026).");
  });

  it("asks for one day as date, a range as from and to", () => {
    expect(dutyArgs("2026-10-15", "2026-10-15")).toEqual({ date: "2026-10-15" });
    expect(dutyArgs("2026-10-12", "2026-10-18", "kamal")).toEqual({ from: "2026-10-12", to: "2026-10-18", driver: "kamal" });
  });
});
