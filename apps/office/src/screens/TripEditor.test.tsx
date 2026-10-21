// The trip editor as the request forms show it (Phase 7, §34): the fields of
// Assign a task, the plan from plan_task with Plan now, the empty leave-by
// filled in from the plan (or left empty where that means "planned"), and the
// departure check's Use button changing the form.
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { FleetProvider } from "../app/FleetContext";
import { FleetStore } from "../data/store";
import type { PlanPreview } from "../data/types";
import type { Me, Transport } from "../transport/types";
import { newStop } from "./stopsLogic";
import { TripEditor, useTrip } from "./TripEditor";
import { emptyTrip, type TripFields, tripPlanInput } from "./tripLogic";

vi.mock("../map/MapView", () => ({ MapView: () => <div data-testid="map" /> }));
vi.mock("../map/google/useGoogleMap", () => ({ useGoogleMap: () => ({ kind: "open" }) }));

const plan: PlanPreview = {
  date: "2026-10-20",
  leave_by: "Tue 20 Oct 07:24",
  leave_by_source: "plan",
  start: { name: "Head office", has_pin: true, lat: 6.9271, lng: 79.8612 },
  stops: [{ seq: 1, n: 1, type: "drop", place: "Galle", arrive_by: "10:00", planned_arrive: "09:55", dwell_min: 5, dwell_source: "default", lat: 6.03, lng: 80.22 }],
  warnings: [],
  timeline: {
    items: [
      { kind: "leave", at: "07:24", source: "plan" },
      { kind: "leg", from_n: "start", to_n: 1, km: 120, minutes: 151, source: "estimate" },
      { kind: "stop", n: 1, label: "Stop 1 · Drop · Galle", place: "Galle", planned_arrive: "09:55", planned_leave: "10:00", arrive_by: "10:00", dwell_min: 5 },
    ],
    totals: { drive_min: 151, km: 120, ends: "10:00" },
  },
};

class Plans implements Transport {
  readonly kind = "api" as const;
  calls: { tool: string; args?: Record<string, unknown> }[] = [];
  me(): Promise<Me> {
    return Promise.resolve({ name: "Nimal", role: "staff", permissions: ["view", "request"], tools: ["plan_task", "create_request"] });
  }
  call<T>(tool: string, args?: Record<string, unknown>): Promise<T> {
    this.calls.push({ tool, args });
    return Promise.resolve(plan as T);
  }
  watch(): () => void {
    return () => {};
  }
  invalidate(): Promise<void> {
    return Promise.resolve();
  }
}

function Harness({ initial }: { initial: TripFields }) {
  const [f, setF] = useState(initial);
  const trip = useTrip(f, setF, { base: null, planInput: tripPlanInput(f, null) });
  return <TripEditor trip={trip} prefix="t" />;
}

async function mount(initial: TripFields) {
  const transport = new Plans();
  const me = await transport.me();
  render(
    <FleetProvider value={{ store: new FleetStore(transport), transport, me, noConnector: false }}>
      <MemoryRouter><Harness initial={initial} /></MemoryRouter>
    </FleetProvider>,
  );
  return transport;
}

/** One drop at Galle by 10:00, and the leave time as given. */
const galle = (leaveBy = ""): TripFields => ({ ...emptyTrip("2026-10-20"), leaveBy, stops: [{ ...newStop("drop"), place: "Galle", arriveBy: "10:00" }] });
const leaveField = () => screen.getByLabelText("Leave by") as HTMLInputElement;

describe("the trip editor", () => {
  // Planned by itself 1.5 s after the last change (no Plan now since 21 October 2026).
  const planned = { timeout: 4000 };
  it("has Assign's trip fields, plans with plan_task by itself, and shows the plan's leave time as a grey suggestion (never filled in)", async () => {
    const transport = await mount(galle());
    for (const label of ["Day", "Leave by", "Back by", "Start from", "Passengers get in here", "Return to office", "No expressway", "Arrive by"]) {
      expect(screen.getByLabelText(label)).toBeTruthy();
    }
    expect(screen.getAllByTestId("stop-row")).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "Plan now" })).toBeNull();
    await waitFor(() => expect(leaveField().placeholder).toBe("07:24 · suggested"), planned);
    expect(leaveField().value).toBe("");
    expect(screen.getByText("Suggested 07:24 from the stops’ arrive-by times. Change it if you like.")).toBeTruthy();
    expect(transport.calls[0]).toMatchObject({ tool: "plan_task", args: { date: "2026-10-20", stops: [{ type: "drop", place: "Galle", arrive_by: "10:00" }] } });
    expect(transport.calls[0].args).not.toHaveProperty("driver");
    expect(transport.calls[0].args).not.toHaveProperty("leave_by"); // the suggestion is never sent back as a chosen time
    expect(screen.getByTestId("plan-line").textContent).toContain("Leave by 07:24");
  });
  it("a typed leave-by that misses an arrive-by gets an amber hint beside it and under the stop; Use hands it back to the planner", async () => {
    await mount(galle("08:00"));
    // Leaving 08:00 shifts the plan's 09:55 arrival to 10:31; with no buffer in this plan, leaving 07:29 makes 10:00.
    await waitFor(() => expect(screen.getByTestId("departure-check").textContent).toContain("Leaving 08:00 you reach Galle at 10:31, 31 min after 10:00. Leave by 07:29."), planned);
    expect((screen.getByTestId("departure-check").firstElementChild as HTMLElement).style.color).toBe("var(--warn)");
    expect(screen.getByTestId("departure-check-stop")).toBeTruthy();
    fireEvent.click(screen.getAllByRole("button", { name: "Use 07:29" })[0]);
    // A missed arrive-by: Use empties the field, so the planner's own time (from the deadlines) applies; never planned again as a chosen time.
    expect(leaveField().value).toBe("");
  });
});
