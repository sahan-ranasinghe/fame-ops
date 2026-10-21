// The dispatch forms' pieces as the office sees them: the plan as a timeline,
// the overlaps as cards, the time at a stop, the departure check's line.
import { fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { FleetProvider } from "../app/FleetContext";
import type { Conflict, PlanTimeline as Timeline } from "../data/types";
import type { FleetStore } from "../data/store";
import type { Me, Transport } from "../transport/types";
import { ConflictCards } from "./ConflictCards";
import { checkDeparture, departurePlan } from "./departureLogic";
import { DepartureNote } from "./dispatchParts";
import { DwellPicker } from "./DwellPicker";
import { PlanTimeline } from "./PlanTimeline";

const me = { name: "Palitha", role: "admin", permissions: ["view", "approve", "assign_tasks"], tools: ["task_detail"] } as Me;
const wrap = (ui: React.ReactNode) => (
  <FleetProvider value={{ me, store: {} as FleetStore, transport: {} as Transport, noConnector: false }}>
    <MemoryRouter>{ui}</MemoryRouter>
  </FleetProvider>
);

const timeline: Timeline = {
  items: [
    { kind: "leave", at: "07:24", source: "plan" },
    { kind: "stop", n: 1, label: "Stop 1 · Pickup · Head office", place: "Head office", planned_arrive: "07:24", planned_leave: "07:29", dwell_min: 5, dwell_source: "default", is_start: true },
    { kind: "leg", from_n: 1, to_n: 2, km: 94.2, minutes: 91, source: "google", rush_factor: 1.3, via_expressway: true },
    { kind: "stop", n: 2, label: "Stop 2 · Drop · Kurunegala site", place: "Kurunegala site", planned_arrive: "09:00", planned_leave: "10:30", arrive_by: "09:00", dwell_min: 90, dwell_source: "place" },
    { kind: "leg", from_n: 2, to_n: 3, km: 12, minutes: 25, source: "ors" },
    { kind: "stop", n: 3, label: "Stop 3 · Visit · Kurunegala town", place: "Kurunegala town", planned_arrive: "10:55", planned_leave: "11:55", arrive_by: "10:30", late_min: 25, dwell_min: 60, dwell_source: "default" },
  ],
  totals: { drive_min: 116, km: 106.2, ends: "11:55" },
};

describe("the plan as a timeline", () => {
  it("leave-by big at the top, a row per stop and per leg, the rush hour and the expressway on lines of their own, the totals", () => {
    render(wrap(<PlanTimeline timeline={timeline} />));
    expect(screen.getByTestId("plan-line").textContent).toBe("Leave by 07:24 · planned from the arrive-by times");
    const stops = screen.getAllByTestId("plan-stop").map((s) => s.textContent);
    expect(stops).toEqual([
      "Stop 1 · Pickup · Head officeleave 07:29 · passengers get in here",
      "Stop 2 · Drop · Kurunegala sitearrive 09:00 · 1 h 30 min (usual here) · leave 10:30 · by 09:00",
      "Stop 3 · Visit · Kurunegala townarrive 10:55 · 1 h · leave 11:55 · by 10:30 · 25 min late",
    ]);
    const legs = screen.getAllByTestId("plan-leg").map((l) => l.textContent);
    expect(legs).toEqual(["94.2 km · 1 h 31 min · Google trafficRush hour ×1.3Via expressway", "12 km · 25 min · openrouteservice"]);
    expect(screen.getByText("25 min late", { exact: false }).className).toContain("bad");
    expect(screen.getByTestId("plan-totals").textContent).toBe("1 h 56 min driving · 106.2 km · ends 11:55");
  });
  it("the exact reason when there is no plan; Updating… while the next one comes", () => {
    const { rerender } = render(wrap(<PlanTimeline reasons={[{ text: "Add a date." }]} />));
    expect(screen.getByTestId("plan-reasons").textContent).toBe("Add a date.");
    rerender(wrap(<PlanTimeline timeline={timeline} updating offset={2} />));
    expect(screen.getByTestId("plan-updating").textContent).toBe("Updating…");
    expect(screen.getAllByTestId("plan-stop")[0].textContent).toMatch(/^Stop 3 · Pickup/);
  });
});

describe("the overlaps as cards", () => {
  const conflicts: Conflict[] = [
    {
      kind: "vehicle",
      text: "WP CAB-4521 is on task Team drop 08:00–11:00 for Dilini (driver Kamal)",
      task: { id: "t9", title: "Team drop", window: "08:00–11:00" },
      requester: { name: "Dilini Jayasinghe", call: "tel:+94771234567", whatsapp: "https://wa.me/94771234567" },
      driver: { name: "Kamal Perera", call: "tel:+94777654321", whatsapp: "https://wa.me/94777654321" },
    },
    { kind: "driver", text: "Kamal is on task School run 08:30–09:30" },
  ];
  it("open that task, call or WhatsApp the requester and the driver, pick another vehicle or driver", () => {
    let picked = "";
    render(wrap(<ConflictCards conflicts={conflicts} onPickVehicle={() => { picked = "vehicle"; }} onPickDriver={() => { picked = "driver"; }} />));
    const [card, second] = screen.getAllByTestId("conflict-card");
    expect(card.textContent).toContain("WP CAB-4521 is on task Team drop 08:00–11:00 for Dilini (driver Kamal)");
    expect(screen.getByRole("link", { name: "Open that task" }).getAttribute("href")).toBe("/tasks/t9");
    expect(screen.getByRole("link", { name: "Call Dilini Jayasinghe (asked for that task)" }).getAttribute("href")).toBe("tel:+94771234567");
    expect(screen.getByRole("link", { name: "WhatsApp Kamal Perera (driver of that task)" }).getAttribute("href")).toBe("https://wa.me/94777654321");
    fireEvent.click(screen.getByRole("button", { name: "Pick another vehicle" }));
    expect(picked).toBe("vehicle");
    expect(second.textContent).toContain("Pick another driver");
    fireEvent.click(screen.getByRole("button", { name: "Pick another driver" }));
    expect(picked).toBe("driver");
  });
});

describe("Stay at a stop (21 October 2026: one field, a sheet of presets and Custom)", () => {
  function Picker({ fallback }: { fallback: { min: number; source: "place" | "default" | "either" } }) {
    const [v, setV] = useState("");
    return <><DwellPicker id="d" value={v} fallback={fallback} onChange={setV} /><output data-testid="value">{v}</output></>;
  }
  it("shows the usual time until a pick; a preset counts at once; Custom 5 h; back to the usual time", () => {
    render(<Picker fallback={{ min: 30, source: "place" }} />);
    expect(screen.getByTestId("dwell-fallback").textContent).toBe("30 min · usual here");
    fireEvent.click(screen.getByRole("button", { name: "Stay" }));
    for (const w of ["5 min", "15 min", "30 min", "1 h", "2 h", "4 h", "Custom"]) expect(within(screen.getByTestId("stay-sheet")).getByRole("button", { name: w })).toBeTruthy();
    fireEvent.click(within(screen.getByTestId("stay-sheet")).getByRole("button", { name: "2 h" }));
    expect(screen.getByTestId("value").textContent).toBe("120");
    fireEvent.click(screen.getByRole("button", { name: "Stay" }));
    fireEvent.click(within(screen.getByTestId("stay-sheet")).getByRole("button", { name: "Custom" }));
    fireEvent.click(screen.getByRole("radio", { name: "5 hours" }));
    fireEvent.click(screen.getByRole("radio", { name: "0 minutes" }));
    fireEvent.click(within(screen.getByTestId("stay-sheet")).getByRole("button", { name: "Done" }));
    expect(screen.getByTestId("value").textContent).toBe("300");
    fireEvent.click(screen.getByRole("button", { name: "Use the usual time here (30 min)" }));
    expect(screen.getByTestId("value").textContent).toBe("");
  });
  it("a request's From and To: the usual time there, else the default", () => {
    render(<Picker fallback={{ min: 5, source: "either" }} />);
    expect(screen.getByTestId("dwell-fallback").textContent).toBe("The usual time there, else 5 min");
  });
});

describe("the departure check beside the fields", () => {
  it("says it in red with Use 07:24 and Move arrive-by to 09:40", () => {
    const tl: Timeline = { items: [{ kind: "leave", at: "07:24", source: "plan" }, { kind: "stop", n: 1, label: "Stop 1 · Drop · Kurunegala site", place: "Kurunegala site", planned_arrive: "09:00", planned_leave: "10:30", arrive_by: "09:00", dwell_min: 90 }], totals: { drive_min: 96, km: 94, ends: "10:30" } };
    const check = checkDeparture("08:00", departurePlan(tl));
    const done: string[] = [];
    render(<DepartureNote check={check} onUse={(t) => done.push(`use ${t}`)} onMove={(n, t) => done.push(`move ${n} ${t}`)} />);
    expect(screen.getByTestId("departure-check").textContent).toContain("Leaving 08:00 you reach Kurunegala site at 09:36, 36 min after 09:00. Leave by 07:24.");
    fireEvent.click(screen.getByRole("button", { name: "Use 07:24" }));
    fireEvent.click(screen.getByRole("button", { name: "Move arrive-by to 09:40" }));
    expect(done).toEqual(["use 07:24", "move 1 09:40"]);
  });
});
