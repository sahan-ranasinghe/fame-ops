// Round 4–7, feature 4: the vehicle checks as the office reads them: the vehicle page's Today's check and last 7 days
// (by day, a problem's note, photos, Open the issue; a notification's check marked), a task's check lines, the issue kind.
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { describe, expect, it } from "vitest";
import { FleetProvider } from "../app/FleetContext";
import { FleetStore } from "../data/store";
import type { IssuesList, VehicleCheck, VehicleChecks } from "../data/types";
import type { Me, Transport, WatchEvent } from "../transport/types";
import { colomboDay } from "../ui/dateRange";
import { kindText } from "./issuesLogic";
import { finishChip, lastWeekArgs } from "./myTripLogic";
import { TaskCheckLines, VehicleChecksSection } from "./VehicleChecks";

const today = colomboDay();
const CHECKS: VehicleCheck[] = [
  {
    id: "c2", date: today, at: "07:42", when: `${today} 07:42`, vehicle: "WP CAB-4521", person: "Kamal Perera", employee_id: "e1",
    result: "problem", result_text: "Problem: Damage", odometer_km: 45210, how: "clock_in", how_text: "Start work", channel: "app",
    report: { id: "rep1", category: "damage", category_text: "Damage", note: "Dent on the back door", status: "open" },
    photos: [{ url: "https://files/p1.jpg", side: null }],
  },
  {
    id: "c1", date: lastWeekArgs("x", today).from, at: "08:10", when: "", vehicle: "WP CAB-4521", person: "Nimali", employee_id: "e2",
    result: "ok", result_text: "All good", odometer_km: 45100, how: "trip", how_text: "Before the trip", channel: "office",
    photos: [{ url: "https://files/front.jpg", side: "front" }],
  },
];

class Fake implements Transport {
  readonly kind = "api" as const;
  calls: { tool: string; args: Record<string, unknown> }[] = [];
  call<T>(tool: string, args: Record<string, unknown> = {}): Promise<T> {
    this.calls.push({ tool, args });
    if (tool === "vehicle_checks") {
      const r: VehicleChecks = { from: String(args.from), to: String(args.to), count: 2, total: 2, problems: 1, checks: CHECKS };
      return Promise.resolve(structuredClone(r) as T);
    }
    if (tool === "list_issues") {
      const r = { status: "all", count: 1, issues: [{ id: "iss9", kind: "vehicle_report", vehicle_report_id: "rep1", title: "Damage", severity: "warning", status: "open" }] } as unknown as IssuesList;
      return Promise.resolve(r as T);
    }
    return Promise.reject({ code: "not_found", message: tool });
  }
  me(): Promise<Me> { return Promise.resolve(me); }
  watch<T>(_t: string, _a: Record<string, unknown>, _cb: (ev: WatchEvent<T>) => void): () => void { return () => {}; }
  invalidate(): Promise<void> { return Promise.resolve(); }
}
const me: Me = { name: "Palitha", role: "fleet_admin", permissions: ["view", "vehicles", "issues"], tools: ["vehicle_checks", "list_issues", "list_vehicles"] };

function Where() {
  const { pathname } = useLocation();
  return <div data-testid="where">{pathname}</div>;
}

async function mount(node: React.ReactNode, person: Me = me) {
  const transport = new Fake();
  render(
    <FleetProvider value={{ store: new FleetStore(transport), transport, me: person, noConnector: false }}>
      <MemoryRouter initialEntries={["/vehicles/WP%20CAB-4521"]}>
        <Routes><Route path="*" element={node} /></Routes>
        <Where />
      </MemoryRouter>
    </FleetProvider>,
  );
  await act(async () => { await Promise.resolve(); });
  return transport;
}

describe("Vehicle checks", () => {
  it("Today's check from list_vehicles, then the last 7 days by day, the problem with its note, photos and issue", async () => {
    const t = await mount(<VehicleChecksSection plate="WP CAB-4521" today={{ result: "problem", result_text: "Problem: Damage", at: "07:42", by: "Kamal Perera" }} />);
    const card = within(screen.getByTestId("vehicle-checks"));
    expect(card.getByTestId("check-today").textContent).toBe("Problem: Damage at 07:42 by Kamal Perera");
    expect(t.calls[0]).toEqual({ tool: "vehicle_checks", args: lastWeekArgs("WP CAB-4521", today) });
    const rows = await card.findAllByTestId("check-row");
    expect(rows).toHaveLength(2);
    expect(card.getByText("Today")).toBeTruthy();
    expect(within(rows[0]).getByText("“Dent on the back door”")).toBeTruthy();
    expect(within(rows[0]).getByText("45,210 km · Start work")).toBeTruthy();
    expect(within(rows[1]).getByAltText("Front")).toBeTruthy();
    expect(card.getByText(/Last 7 days · 2 · 1 with a problem/)).toBeTruthy();
    await act(async () => { fireEvent.click(within(rows[0]).getByTestId("check-open-issue")); });
    expect(t.calls.at(-1)).toEqual({ tool: "list_issues", args: { kind: "vehicle_report", vehicle: "WP CAB-4521", status: "all", from: today, limit: 50 } });
    expect(screen.getByTestId("where").textContent).toBe("/issues/iss9");
  });

  it("no check today says so; a notification's check is marked; without vehicle_checks only today's line", async () => {
    await mount(<VehicleChecksSection plate="WP CAB-4521" focus="c1" />);
    expect(screen.getByTestId("check-today").textContent).toBe("No check today");
    const rows = await screen.findAllByTestId("check-row");
    expect(rows[1].getAttribute("aria-current")).toBe("true");
    expect(rows[0].getAttribute("aria-current")).toBeNull();
  });

  it("a person without the tool sees today's line only", async () => {
    const t = await mount(<VehicleChecksSection plate="WP CAB-4521" />, { ...me, tools: ["list_vehicles"] });
    expect(screen.getByTestId("check-today").textContent).toBe("No check today");
    expect(screen.queryByText(/Last 7 days/)).toBeNull();
    expect(t.calls).toEqual([]);
  });

  it("a task's check lines and its finish chip; the issue kind Trip not confirmed has its words", async () => {
    await mount(<dl><TaskCheckLines checks={CHECKS} /></dl>);
    expect(screen.getAllByTestId("task-check").map((e) => e.firstChild?.textContent)).toEqual(["Vehicle check 07:42 · Problem: Damage", "Vehicle check 08:10 · All good"]);
    expect(finishChip({ kind: "not_confirmed" })?.text).toBe("Completed · not confirmed");
    expect(kindText({ kind: "trip_not_confirmed" })).toBe("Trip not confirmed");
  });
});
