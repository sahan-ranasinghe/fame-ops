import { describe, expect, it } from "vitest";
import { dueFromVehicles } from "./maintenanceLogic";

describe("Maintenance reminders from the vehicles list", () => {
  it("lists documents, service, rent and garage dates within 14 days, soonest first, red within 7", () => {
    const rows = dueFromVehicles([
      {
        reg_no: "WP CAB-4521", make_model: "Toyota HiAce", rented_from: "City Wheels", rent_until: "2026-10-20",
        documents: { lic: { chip: "red", expiry: "2026-10-16" }, ins: { chip: "ok", expiry: "2027-03-01" }, emi: { chip: "orange", expiry: "2026-10-25" } },
        service_state: "due soon", next_service: "In 400 km", garage_booked: "2026-10-14",
      },
      { reg_no: "WP KA-1", active: false, documents: { lic: { chip: "red", expiry: "2026-10-13" } } },
    ], "2026-10-13");
    expect(rows.map((r) => [r.what, r.due, r.level])).toEqual([
      ["Garage booked", "tomorrow", "amber"],
      ["Revenue licence expires", "in 3 days", "red"],
      ["Rental agreement ends", "in 7 days", "red"],
      ["Service due", "soon", "amber"],
      ["Emission test expires", "Sun 25 Oct", "amber"],
    ]);
    expect(rows[1].subject).toBe("WP CAB-4521 · Toyota HiAce");
    expect(rows[2].subject).toBe("WP CAB-4521 · City Wheels");
  });
  it("is empty when nothing is due", () => {
    expect(dueFromVehicles([{ reg_no: "X", documents: { lic: { chip: "ok", expiry: "2027-01-01" } }, service_state: "ok" }], "2026-10-13")).toEqual([]);
  });
});
