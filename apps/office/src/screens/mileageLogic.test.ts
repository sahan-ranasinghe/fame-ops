import { describe, expect, it } from "vitest";
import type { MileageSummary, MileageTotals } from "../data/types";
import { allowanceRows, fuelLabel, fuelMonthLine, mileageView, monthLine, monthName, personalLine, rangeArgs, wholeMonth } from "./mileageLogic";

const totals = (over: Partial<MileageTotals> = {}): MileageTotals => ({
  tasks: 12, task_km: 840, fuel_litres: 310, fuel_lkr: 120500, unlogged_km_flags: 0, check_odometer: 0, between_tasks_km: 20, overnight_km: 15, ...over,
});

const month: MileageSummary = {
  month: "2026-10",
  totals: totals(),
  vehicles: [{ vehicle: "WP CAB-4521", tasks: 12, task_km: 840, odometer_km: 900, km_allowance: 2500, between_tasks_km: 20, overnight_km: 15, fuel_litres: 310, fuel_lkr: 120500, fuel_entries: 9 }],
  biggest_gaps: [],
  unlogged_km: [],
  check_odometer: [],
};

describe("mileage and fuel over a range of days (§8)", () => {
  it("asks for a whole calendar month as month, any other days as from/to, with the filters chosen", () => {
    expect(wholeMonth("2026-10-01", "2026-10-31")).toBe("2026-10");
    expect(wholeMonth("2028-02-01", "2028-02-29")).toBe("2028-02");
    expect(wholeMonth("2026-10-01", "2026-10-30")).toBeUndefined();
    expect(wholeMonth("2026-09-01", "2026-10-31")).toBeUndefined();
    expect(rangeArgs("2026-10-01", "2026-10-31")).toEqual({ month: "2026-10" });
    expect(rangeArgs("2026-10-12", "2026-10-18", { vehicle: "WP CAB-4521" })).toEqual({ from: "2026-10-12", to: "2026-10-18", vehicle: "WP CAB-4521" });
    expect(rangeArgs("2026-10-18", "2026-10-18", { driver: "nuwan.p", vehicle: "" })).toEqual({ from: "2026-10-18", to: "2026-10-18", driver: "nuwan.p" });
    expect(monthName("2026-10")).toBe("October 2026");
  });

  it("a whole month is one set of figures with the allowance; shorter days show theirs and the month that contains To", () => {
    const whole = mileageView(month);
    expect(whole.label).toBe("October 2026");
    expect(whole.month).toBeUndefined();
    expect(whole.vehicles[0].km_allowance).toBe(2500);

    const day = totals({ tasks: 1, task_km: 41, personal_km: 12, between_tasks_km: 0, overnight_km: 0, fuel_litres: 0, fuel_lkr: 0 });
    const ranged = mileageView({
      ...month,
      totals: totals({ personal_km: 12 }),
      vehicles: [{ ...month.vehicles[0], personal_km: 12, personal_trips: 1 }],
      range: { from: "2026-10-18", to: "2026-10-18", totals: day, vehicles: [{ vehicle: "WP CAB-4521", tasks: 1, task_km: 41, personal_km: 12 }], biggest_gaps: [], unlogged_km: [], check_odometer: [] },
    });
    expect(ranged.label).toBe("Sun 18 Oct 2026");
    expect(ranged.totals).toBe(day);
    expect(ranged.vehicles).toEqual([{ vehicle: "WP CAB-4521", tasks: 1, task_km: 41, personal_km: 12 }]);
    expect(ranged.month?.label).toBe("October 2026");
    expect(ranged.month?.rows).toEqual([{ vehicle: "WP CAB-4521", task_km: 840, personal_km: 12, odometer_km: 900, km_allowance: 2500 }]);
  });

  it("each vehicle against its allowance: only the columns the answer has (a driver's view has no odometer)", () => {
    expect(allowanceRows([{ vehicle: "WP CAB-4521", tasks: 3, task_km: 120, over_allowance: true, odometer_km: 2600, km_allowance: 2500 }]))
      .toEqual([{ vehicle: "WP CAB-4521", task_km: 120, odometer_km: 2600, km_allowance: 2500, over_allowance: true }]);
    expect(allowanceRows([{ vehicle: "WP CAB-4521", tasks: 3, task_km: 120 }])).toEqual([{ vehicle: "WP CAB-4521", task_km: 120 }]);
  });

  it("personal km in a line only when any, and the month in one line", () => {
    expect(personalLine(totals())).toBeUndefined();
    expect(personalLine(totals({ personal_km: 42 }))).toBe("Personal km: 42 km, never charged to a job.");
    expect(monthLine(totals())).toBe("12 tasks · 840 task km · 35 km outside tasks · 310 litres · LKR 120,500");
    expect(monthLine(totals({ tasks: 1, personal_km: 8 }))).toBe("1 task · 840 task km · 8 personal km · 35 km outside tasks · 310 litres · LKR 120,500");
  });

  it("fuel: the days in words and the month beside a range", () => {
    expect(fuelLabel({ month: "2026-10" })).toBe("October 2026");
    expect(fuelLabel({ month: "2026-10", from: "2026-10-12", to: "2026-10-18" })).toBe("Mon 12 Oct – Sun 18 Oct 2026");
    expect(fuelMonthLine({ month: "2026-10" })).toBeUndefined();
    expect(fuelMonthLine({ month: "2026-10", month_totals: { entries: 12, litres: 310.5, lkr: 120500 } })).toBe("October 2026: 12 fills · 310.5 litres · LKR 120,500");
    expect(fuelMonthLine({ month: "2026-10", month_totals: { entries: 1, litres: 20, lkr: 7400 } })).toBe("October 2026: 1 fill · 20 litres · LKR 7,400");
  });
});
