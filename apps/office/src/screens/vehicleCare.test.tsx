// Round 4–7 (item 8, §33.7; Fleetio): Maintenance and Reminders hold only service and documents, one card per vehicle.
// The rules (vehicleCareLogic.ts), the Maintenance page's cards beside the drivers' problem reports (every action of
// the page is still there), and the Reminders cards (the server's reminders per vehicle, the rest counted to Issues).
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { describe, expect, it } from "vitest";
import { FleetProvider } from "../app/FleetContext";
import { FleetStore } from "../data/store";
import type { Attention, VehicleCard } from "../data/types";
import type { Me, Transport, WatchEvent } from "../transport/types";
import { ToastProvider } from "../ui/Toast";
import { Maintenance } from "./Maintenance";
import { reminderCounts, reminderSummary, reminderTile } from "./overviewLinks";
import { ReminderCards } from "./Reminders";
import { careCards, careCounts, careOf, docsOf, isDue, readService, serviceOf, summaryText } from "./vehicleCareLogic";

const TODAY = "2026-10-22";

const van = (over: Partial<VehicleCard> = {}): VehicleCard => ({
  reg_no: "WP CAB-4521", make_model: "Toyota HiAce", next_service: "In 1,120 km or 2 Nov", service_state: "due soon",
  documents: { lic: { chip: "ok", expiry: "2027-03-01", days_left: 130 }, ins: { chip: "orange", expiry: "2026-11-10", days_left: 19 }, emi: { chip: "not set" } },
  documents_missing: ["emission"], ...over,
});

describe("the service and documents of a vehicle (vehicleCareLogic)", () => {
  it("reads the server's service words back: km to go or over, the date nearest today", () => {
    expect(readService("In 1,120 km or 2 Nov", TODAY)).toEqual({ km: 1120, date: "2026-11-02" });
    expect(readService("320 km over or 30 Sep", TODAY)).toEqual({ km: -320, date: "2026-09-30" });
    expect(readService("5 Jan", TODAY)).toEqual({ date: "2027-01-05" });
    expect(readService("Not set", TODAY)).toEqual({});
  });

  it("the service: the server's state, the bar full when due, empty far away; not set has no bar", () => {
    const soon = serviceOf({ next_service: "In 1,120 km or 2 Nov", service_state: "due soon" }, TODAY);
    expect(soon).toMatchObject({ state: "due_soon", km: 1120, date: "2026-11-02", days: 11 });
    expect(soon.fill).toBeCloseTo(Math.max(1 - 1120 / 5000, 1 - 11 / 90), 5);
    expect(serviceOf({ next_service: "320 km over", service_state: "overdue" }, TODAY).fill).toBe(1);
    expect(serviceOf({ next_service: "In 9,000 km", service_state: "ok" }, TODAY).fill).toBe(0);
    expect(serviceOf({ next_service: "Not set", service_state: "not set" }, TODAY)).toEqual({ state: "not_set", fill: 0 });
    expect(serviceOf({ next_service: "In 4,000 km", service_state: "ok", garage_booked: "2026-10-23" }, TODAY).garage).toBe("2026-10-23");
    expect(serviceOf({ next_service: "In 4,000 km", service_state: "ok", garage_booked: "2026-10-01" }, TODAY).garage).toBeUndefined();
  });

  it("the documents as chips: expired, expiring (30 days), missing, no date, ok; the CR and lease only when missing or held; the rental", () => {
    const docs = docsOf({
      documents: { lic: { expiry: "2026-10-20", days_left: -2 }, ins: { expiry: "2026-11-10", days_left: 19 }, emi: {} },
      documents_missing: ["emission", "registration"],
      document_files: [{ kind: "lease", has_file: true }],
      rent_until: "2026-12-31",
    }, TODAY);
    expect(docs.map((d) => [d.kind, d.state])).toEqual([
      ["revenue_licence", "expired"], ["insurance", "expiring"], ["emission", "missing"], ["registration", "missing"], ["lease", "ok"], ["rental", "ok"],
    ]);
    expect(docsOf({ documents: {} }, TODAY).map((d) => d.state)).toEqual(["no_date", "no_date", "no_date"]);
  });

  it("the order: overdue or expired first, then due soon / expiring / missing, then in order; the soonest first; inactive left out", () => {
    const cards = careCards([
      van({ reg_no: "A-OK", next_service: "In 9,000 km", service_state: "ok", documents: { lic: { expiry: "2027-05-01", days_left: 190 } }, documents_missing: [] }),
      van({ reg_no: "B-SOON" }),
      van({ reg_no: "C-OVER", next_service: "320 km over", service_state: "overdue" }),
      van({ reg_no: "D-GONE", active: false }),
    ], TODAY);
    expect(cards.map((c) => [c.reg_no, c.level])).toEqual([["C-OVER", 2], ["B-SOON", 1], ["A-OK", 0]]);
    const counts = careCounts(cards);
    expect(counts).toMatchObject({ vehicles: 3, attention: 2, serviceOverdue: 1, serviceSoon: 1, expiring: 2, missing: 2 });
    expect(summaryText(counts)).toBe("1 service overdue · 1 service due soon · 2 documents expiring · 2 documents missing");
    expect(summaryText(careCounts([]))).toBe("Every service and document is in order.");
  });

  it("due for the reminders: the service due, or a document expired, missing or ending within the window", () => {
    expect(isDue(careOf(van(), TODAY))).toBe(true);
    const later = careOf(van({ next_service: "In 4,000 km", service_state: "ok", documents_missing: [], documents: { ins: { expiry: "2026-11-15", days_left: 24 } } }), TODAY);
    expect(isDue(later, 14)).toBe(false);
    expect(isDue(later, 30)).toBe(true);
  });

  it("the Overview's tile counts the service and document reminders only (and the red ones)", () => {
    const items = [
      { kind: "service_due", level: "red" }, { kind: "document", level: "amber" }, { kind: "licence", level: "red" },
      { kind: "missed_task", level: "red" }, { kind: "odometer_flag", level: "amber" }, { kind: "allowance", level: "amber" },
    ];
    expect(reminderTile(items)).toEqual({ count: 3, red: 2 });
    expect(reminderTile(undefined)).toEqual({ count: 0, red: 0 });
  });
});

const ADMIN: Me = {
  name: "Sahan", role: "admin", permissions: ["view", "vehicles", "issues", "assign_tasks"],
  tools: ["list_vehicles", "list_vehicle_reports", "update_vehicle_report", "update_vehicle", "fleet_overview"],
};

class FakeTransport implements Transport {
  readonly kind = "api" as const;
  calls: { tool: string; args: Record<string, unknown> }[] = [];
  constructor(private vehicles: VehicleCard[], private needs: Attention[] = []) {}
  me() {
    return Promise.resolve(ADMIN);
  }
  answer(tool: string, args: Record<string, unknown>): unknown {
    if (tool === "list_vehicles") return { filter: "all", counts: {}, vehicles: this.vehicles };
    if (tool === "fleet_overview") return { needs_attention: this.needs, reminders: { count: this.needs.length, window_days: 14 } };
    if (tool === "list_vehicle_reports") {
      const reports = [{ id: "r1", reported: "2026-10-22 09:10", vehicle: "WP CAB-4521", driver: "Kamal", category: "tyre", status: "open", note: "Flat", photos: ["https://x/p.jpg"], task_id: "t1", driver_links: { call: "tel:+94771234567" } }];
      return { status: args.status, count: 1, total: 1, reports };
    }
    return {};
  }
  call<T>(tool: string, args: Record<string, unknown> = {}): Promise<T> {
    this.calls.push({ tool, args });
    return Promise.resolve(structuredClone(this.answer(tool, args)) as T);
  }
  watch<T>(tool: string, args: Record<string, unknown>, cb: (ev: WatchEvent<T>) => void): () => void {
    void this.call<T>(tool, args).then((data) => cb({ type: "data", data, at: Date.now() }));
    return () => {};
  }
  invalidate() {
    return Promise.resolve();
  }
}

function Where() {
  const l = useLocation();
  return <output data-testid="where">{l.pathname + l.search}</output>;
}

async function mountMaintenance(vehicles: VehicleCard[], needs: Attention[] = [], transport = new FakeTransport(vehicles, needs)) {
  const store = new FleetStore(transport);
  store.watch("overview", "fleet_overview", {}, 30000);
  render(
    <FleetProvider value={{ store, transport, me: ADMIN, noConnector: false }}>
      <ToastProvider>
        <MemoryRouter initialEntries={["/maintenance"]}>
          <Routes><Route path="/maintenance" element={<Maintenance />} /><Route path="/vehicles/:reg" element={<div data-testid="vehicle-page" />} /></Routes>
          <Where />
        </MemoryRouter>
      </ToastProvider>
    </FleetProvider>,
  );
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
  return transport;
}

describe("Maintenance: the service and documents as cards (Fleetio)", () => {
  const fleet = () => [
    van(),
    van({ reg_no: "WP KL-1234", next_service: "320 km over", service_state: "overdue", documents_missing: [] }),
    van({ reg_no: "WP PH-2087", next_service: "In 9,000 km", service_state: "ok", documents: { lic: { expiry: "2027-05-01", days_left: 190 }, ins: { expiry: "2027-05-01", days_left: 190 }, emi: { expiry: "2027-05-01", days_left: 190 } }, documents_missing: [] }),
  ];

  it("the summary first, then one card per vehicle that needs attention (overdue first); All vehicles shows every one; a card opens the vehicle", async () => {
    await mountMaintenance(fleet());
    expect((await screen.findByTestId("care-summary")).textContent).toContain("2 of 3 vehicles need attention");
    const list = screen.getByTestId("care-list");
    const cards = within(list).getAllByTestId("care-card");
    expect(cards.map((c) => c.getAttribute("href"))).toEqual(["/vehicles/WP%20KL-1234", "/vehicles/WP%20CAB-4521"]);
    expect(within(cards[1]).getByTestId("care-service").textContent).toContain("In 1,120 km or");
    expect(within(cards[1]).getByRole("meter")).toBeTruthy();
    expect(within(cards[1]).getByTestId("care-docs").textContent).toContain("Insurance · in 19 days");
    expect(within(cards[1]).getByTestId("care-docs").textContent).toContain("Emission test · missing");
    fireEvent.click(screen.getByRole("tab", { name: "All vehicles" }));
    expect(screen.getByTestId("where").textContent).toBe("/maintenance?show=all");
    expect(within(screen.getByTestId("care-list")).getAllByTestId("care-card")).toHaveLength(3);
    fireEvent.click(within(screen.getByTestId("care-list")).getAllByTestId("care-card")[0]);
    expect(screen.getByTestId("vehicle-page")).toBeTruthy();
  });

  it("missed tasks, odometer checks and the rest of the overview's list are counted in one line to Issues", async () => {
    await mountMaintenance(fleet(), [
      { what: "Missed task", kind: "missed_task", level: "red" }, { what: "Odometer check", kind: "odometer_flag", level: "amber" },
      { what: "Insurance expires", kind: "document", level: "amber", vehicle: "WP CAB-4521" }, { what: "Vehicle problem: tyre", kind: "vehicle_report", level: "red" },
    ]);
    const line = await screen.findByTestId("maintenance-issues");
    expect(line.textContent).toContain("2 more things need attention");
    expect(line.getAttribute("href")).toBe("/issues");
  });

  // The fresh reviewer (22 October 2026): the drivers' licences were neither a card nor counted; the parity doc says counted.
  it("the drivers' licences are counted in the line to Issues (they are no vehicle's card)", async () => {
    await mountMaintenance(fleet(), [
      { what: "Licence expires", subject: "Kamal Silva", kind: "licence", level: "red", issue_id: "l1" },
      { what: "Insurance expires", kind: "document", level: "amber", vehicle: "WP CAB-4521" },
    ]);
    const line = await screen.findByTestId("maintenance-issues");
    expect(line.textContent).toContain("1 more thing needs attention");
    expect(line.textContent).toContain("Driver licences");
  });

  it("the vehicles list failing: its error with Try again (never a skeleton for ever); Try again loads the cards", async () => {
    class Failing extends FakeTransport {
      fail = true;
      answer(tool: string, args: Record<string, unknown>): unknown {
        if (tool === "list_vehicles" && this.fail) throw { code: "tool_error", message: "Fame Fleet refused." };
        return super.answer(tool, args);
      }
    }
    const t = new Failing(fleet());
    await mountMaintenance(fleet(), [], t);
    expect((await screen.findByTestId("care-error")).textContent).toBe("Fame Fleet refused.");
    expect(screen.queryByText("Loading the vehicles…")).toBeNull();
    t.fail = false;
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Try again" })); });
    expect((await screen.findByTestId("care-summary")).textContent).toContain("2 of 3 vehicles need attention");
    expect(screen.queryByTestId("care-error")).toBeNull();
  });

  it("every action the page had is still there: the reports' search and status filter, a report's photos, task, call, status, note, off the road, Save", async () => {
    await mountMaintenance(fleet());
    const reports = await screen.findByTestId("reports-list");
    expect(screen.getByLabelText("Search")).toBeTruthy();
    expect(screen.getByTestId("filter-button")).toBeTruthy();
    expect(within(reports).getByRole("link", { name: "Photo 1" })).toBeTruthy();
    expect(within(reports).getByRole("link", { name: "Open task →" })).toBeTruthy();
    expect(within(reports).getByRole("link", { name: "Call driver" })).toBeTruthy();
    expect(within(reports).getByLabelText("Status")).toBeTruthy();
    expect(within(reports).getByLabelText("Note for the driver")).toBeTruthy();
    expect(within(reports).getByLabelText(/Also take WP CAB-4521 off the road/)).toBeTruthy();
    expect(within(reports).getByRole("button", { name: "Save" })).toBeTruthy();
  });
});

describe("Reminders: one card per vehicle", () => {
  it("the server's reminders grouped by plate in its order; the licences as rows; the rest counted to Issues", () => {
    const items: Attention[] = [
      { what: "Service overdue", subject: "WP CAB-4521 · 1,200 km over", due: "now", level: "red", kind: "service_due", vehicle: "WP CAB-4521", issue_id: "i1" },
      { what: "Insurance expires", subject: "WP KL-1234", due: "in 5 days", level: "amber", kind: "document", vehicle: "WP KL-1234", issue_id: "i2" },
      { what: "Revenue licence expires", subject: "WP CAB-4521", due: "in 9 days", level: "amber", kind: "document", vehicle: "WP CAB-4521", issue_id: "i3" },
      { what: "Licence expires", subject: "Kamal Silva", due: "in 3 days", level: "red", kind: "licence", issue_id: "i4" },
      { what: "Missed task", subject: "Team drop", due: "2 h ago", level: "red", kind: "missed_task", issue_id: "i5" },
    ];
    render(<MemoryRouter><ReminderCards items={items} vehicles={[van({ next_service: "1,200 km over", service_state: "overdue" })]} issues /></MemoryRouter>);
    const cards = screen.getAllByTestId("reminder-card");
    expect(cards.map((c) => c.dataset.plate)).toEqual(["WP CAB-4521", "WP KL-1234"]);
    expect(within(cards[0]).getAllByTestId("reminder-row").map((r) => r.textContent?.slice(0, 15))).toEqual(["Service overdue", "Revenue licence"]);
    expect(within(cards[0]).getByRole("meter")).toBeTruthy();
    expect(screen.getByTestId("reminders-due").textContent).toContain("Licence expires");
    expect(screen.getByTestId("reminders-issues").textContent).toContain("1 more needs attention");
    // The fresh reviewer (22 October 2026): the tile said 3, the panel 1 (vehicles). Now both count the reminders, and the
    // panel says what they are on: the tile's number is the summary's first.
    expect(screen.getByTestId("reminders-summary").textContent).toBe(`${reminderTile(items).count} reminders · 2 vehicles · 1 driver licence`);
    expect(reminderTile(items).count).toBe(4);
  });

  it("the reminders in numbers: as many as the tile counts, the vehicles and the licences", () => {
    const items: Attention[] = [
      { what: "Service overdue", subject: "WP CAB-4521", level: "red", kind: "service_due", vehicle: "WP CAB-4521" },
      { what: "Insurance expires", subject: "WP CAB-4521", level: "amber", kind: "document", vehicle: "WP CAB-4521" },
      { what: "Emission test expires", subject: "WP CAB-4521", level: "amber", kind: "document", vehicle: "WP CAB-4521" },
      { what: "Km allowance", subject: "WP CAB-4521", level: "amber", kind: "allowance", vehicle: "WP CAB-4521" },
    ];
    expect(reminderCounts(items)).toEqual({ reminders: 3, vehicles: 1, licences: 0 });
    expect(reminderCounts(items).reminders).toBe(reminderTile(items).count);
    expect(reminderSummary(reminderCounts(items))).toBe("3 reminders · 1 vehicle");
    expect(reminderSummary({ reminders: 1, vehicles: 0, licences: 1 })).toBe("1 reminder · 1 driver licence");
    expect(reminderCounts(undefined)).toEqual({ reminders: 0, vehicles: 0, licences: 0 });
  });

  it("without the issues permission: the vehicles list says what is due", () => {
    render(<MemoryRouter><ReminderCards items={[]} vehicles={[van(), van({ reg_no: "OK-1", next_service: "In 9,000 km", service_state: "ok", documents_missing: [], documents: {} })]} issues={false} windowDays={14} /></MemoryRouter>);
    const cards = screen.getAllByTestId("reminder-card");
    expect(cards.map((c) => c.dataset.plate)).toEqual(["WP CAB-4521"]);
    expect(cards[0].textContent).toContain("Emission test · missing");
    expect(screen.getByTestId("reminders-summary").textContent).toBe("1 vehicle due");
  });
});
