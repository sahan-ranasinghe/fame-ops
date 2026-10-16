// The plan map beside its timeline (Phase 7, §20) as the office uses it: the pins the map gets, a pin and a row
// highlighting each other, Google's place listed (not drawn) off Google's map, the phone's fixed-height block.
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PlanTimeline } from "../data/types";
import type { MapProps } from "../map/types";
import { PlanWithMap } from "./PlanMap";
import { stopPin } from "./planMapLogic";

const seen: { props: MapProps | null } = { props: null };
vi.mock("../map/MapView", () => ({
  MapView: (p: MapProps) => {
    seen.props = p;
    return (
      <div data-testid="map" data-height={p.height}>
        {p.plan?.pins.map((pin) => <button type="button" key={pin.id} data-testid={`pin-${pin.id}`} data-selected={p.plan?.selected === pin.id} onClick={() => p.onPin?.(pin.id)}>{pin.label}</button>)}
      </div>
    );
  },
}));
const google = { on: false };
vi.mock("../map/google/useGoogleMap", () => ({ useGoogleMap: () => (google.on ? { kind: "google", state: "ready", maps: {} } : { kind: "open" }) }));

const timeline: PlanTimeline = {
  items: [
    { kind: "leave", at: "07:24", source: "plan" },
    { kind: "leg", from_n: "start", to_n: 1, km: 94, minutes: 96, source: "google" },
    { kind: "stop", n: 1, label: "Stop 1 · Drop · Kurunegala site", place: "Kurunegala site", planned_arrive: "09:00", planned_leave: "10:30", arrive_by: "09:00", dwell_min: 90 },
    { kind: "leg", from_n: 1, to_n: 2, km: 2, minutes: 8, source: "google" },
    { kind: "stop", n: 2, label: "Stop 2 · Visit · Kurunegala town", place: "Kurunegala town", planned_arrive: "10:38", planned_leave: "11:38", dwell_min: 60 },
  ],
  totals: { drive_min: 104, km: 96, ends: "11:38" },
};
const stops = [{ n: 1, place: "Kurunegala site", lat: 7.4863, lng: 80.3623 }, { n: 2, place: "Kurunegala town", lat: 7.4818, lng: 80.3609, google: true }];
const start = { name: "Head office", lat: 6.9271, lng: 79.8612 };

function setPhone(on: boolean) {
  window.matchMedia = ((q: string) => ({ matches: on, media: q, addEventListener: () => undefined, removeEventListener: () => undefined })) as unknown as typeof window.matchMedia;
}

afterEach(() => {
  google.on = false;
  seen.props = null;
  setPhone(false);
});

describe("the plan map", () => {
  it("gives the map the start and the stops; a Google place is listed, not drawn, off Google's map", () => {
    setPhone(false);
    render(<PlanWithMap timeline={timeline} stops={stops} start={start} />);
    expect(seen.props?.plan?.pins.map((p) => p.label)).toEqual(["S · Head office · leave 07:24", "1 · Kurunegala site · 09:00–10:30"]);
    expect(seen.props?.markers).toEqual([]);
    expect(seen.props?.route).toBeNull();
    expect(screen.getByTestId("plan-map-google").textContent).toBe("Google place, not drawn: 2 · Kurunegala town");
    expect(screen.getByTestId("map").dataset.height).toBe("360");
  });

  it("on Google's map the Google place is drawn", () => {
    google.on = true;
    render(<PlanWithMap timeline={timeline} stops={stops} start={start} />);
    expect(seen.props?.plan?.pins.map((p) => p.n)).toEqual(["S", 1, 2]);
    expect(screen.queryByTestId("plan-map-google")).toBeNull();
  });

  it("a pin tapped highlights its row; a row hovered or tapped highlights its pin", () => {
    render(<PlanWithMap timeline={timeline} stops={stops} start={start} />);
    const rows = screen.getAllByTestId("plan-stop");
    fireEvent.click(screen.getByTestId(`pin-${stopPin(1)}`));
    expect(rows[0].getAttribute("aria-pressed")).toBe("true");
    expect(rows[0].getAttribute("style")).toContain("var(--warn-bg)");
    fireEvent.mouseEnter(rows[1]);
    expect(seen.props?.plan?.selected).toBe(stopPin(2));
    fireEvent.mouseLeave(rows[1]);
    expect(seen.props?.plan?.selected).toBe(stopPin(1));
    fireEvent.click(rows[0]); // tapped again: none
    expect(seen.props?.plan?.selected).toBeNull();
    fireEvent.click(screen.getAllByTestId("plan-leg")[0]); // the leg from the start is the start's row
    expect(seen.props?.plan?.selected).toBe("start");
    // The text of the rows is unchanged by the highlight.
    expect(rows[0].textContent).toBe("Stop 1 · Drop · Kurunegala sitearrive 09:00 · 1 h 30 · leave 10:30 · by 09:00");
  });

  it("on a phone the map is a fixed-height block above the timeline", async () => {
    setPhone(true);
    render(<PlanWithMap timeline={timeline} stops={stops} start={start} />);
    await act(async () => { await Promise.resolve(); });
    const box = screen.getByTestId("plan-with-map");
    expect(screen.getByTestId("map").dataset.height).toBe("260");
    expect(box.firstElementChild?.getAttribute("data-testid")).toBe("plan-map");
    expect(box.lastElementChild?.getAttribute("data-testid")).toBe("plan-timeline");
  });

  it("without a plan it is the timeline alone (the reasons)", () => {
    render(<PlanWithMap reasons={[{ text: "Add a date." }]} stops={stops} start={start} />);
    expect(screen.queryByTestId("map")).toBeNull();
    expect(screen.getByTestId("plan-reasons").textContent).toBe("Add a date.");
  });

  it("keeps the map while a new plan is planned: the same map node, the pins of the newest answer", () => {
    const { rerender } = render(<PlanWithMap timeline={timeline} stops={stops} start={start} />);
    const map = screen.getByTestId("map");
    const moved = { ...timeline, items: timeline.items.map((x) => (x.kind === "stop" && x.n === 1 ? { ...x, planned_arrive: "09:10" } : x)) };
    rerender(<PlanWithMap timeline={moved} stops={stops} start={{ ...start }} updating />);
    expect(screen.getByTestId("map")).toBe(map);
    expect(seen.props?.plan?.pins[1].label).toBe("1 · Kurunegala site · 09:10–10:30");
  });
});
