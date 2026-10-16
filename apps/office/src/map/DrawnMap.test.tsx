import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import DrawnMap from "./DrawnMap";
import type { GapMarker, MapRoute } from "./types";

const route: MapRoute = {
  points: [
    { lat: 6.9, lng: 79.86, kmh: 30 },
    { lat: 7.0, lng: 79.95, kmh: 40 },
    { lat: 7.2, lng: 80.1, kmh: 40 },
    { lat: 7.3, lng: 80.2, kmh: 30, gapBefore: true },
  ],
  bySpeed: true,
  stops: [{ lat: 7.0, lng: 79.95, label: "10:05–10:31" }],
  // The old labels are still in the data: no map may draw them (§21).
  holes: [{ from: { lat: 6.9, lng: 79.86 }, to: { lat: 7.0, lng: 79.95 }, label: "App not running · 42 min" }],
  estimated: [{ points: [{ lat: 7.2, lng: 80.1 }, { lat: 7.25, lng: 80.15 }, { lat: 7.3, lng: 80.2 }], label: "estimated · 21.3 km road" }],
};
const gaps: GapMarker[] = [
  { id: "g1", kind: "no_data", lat: 6.95, lng: 79.9, text: "App not running · 09:12–09:54 · 42 min · about 9.1 km by road" },
  { id: "g2", kind: "no_gps", lat: 7.25, lng: 80.15, text: "Stopped · no GPS signal · 11:02–11:20 · 18 min" },
  { id: "g3", kind: "late", lat: 7.1, lng: 80.0, text: "Offline here · uploaded 14:20" },
];
const words = [...gaps.map((g) => g.text), "App not running", "Stopped", "Offline here", "42 min", "estimated", "21.3 km", "uploaded"];

const svgText = (c: HTMLElement) => c.querySelector("svg")!.textContent ?? "";

describe("the drawn map (Phase 7, Part 2b)", () => {
  it("no map has permanent text for a gap: holes and estimated lines stay dashed, one marker per gap, no words", () => {
    const { container } = render(<DrawnMap markers={[]} route={route} gaps={gaps} onPick={() => undefined} />);
    const text = svgText(container);
    for (const w of words) expect(text).not.toContain(w);
    expect(container.querySelectorAll("polyline.hole")).toHaveLength(1);
    expect(container.querySelectorAll('[data-testid="estimated-line"]')).toHaveLength(1);
    expect(container.querySelectorAll('[data-testid="gap-marker"]')).toHaveLength(3);
    expect(container.querySelector('[data-testid="gap-card"]')).toBeNull();
    // The stop circles keep their times.
    expect(text).toContain("10:05–10:31");
    // Each marker is named by its words for a screen reader (an attribute, not text on the map).
    expect(container.querySelector('[data-testid="gap-marker"]')!.getAttribute("aria-label")).toBe(gaps[0].text);
  });

  it("hover shows the card, leaving hides it; a tap opens it and tells the page, a tap on the map closes it", () => {
    const onGap = vi.fn();
    const { container } = render(<DrawnMap markers={[]} route={route} gaps={gaps} onGap={onGap} onPick={() => undefined} />);
    const marker = container.querySelectorAll('[data-testid="gap-marker"]')[1];
    fireEvent.mouseEnter(marker);
    expect(svgText(container)).toContain("Stopped");
    expect(svgText(container)).toContain("11:02–11:20 · 18 min");
    fireEvent.mouseLeave(marker);
    expect(container.querySelector('[data-testid="gap-card"]')).toBeNull();
    expect(onGap).not.toHaveBeenCalled();
    fireEvent.click(marker);
    expect(onGap).toHaveBeenLastCalledWith("g2");
    expect(container.querySelectorAll('[data-testid="gap-card"]')).toHaveLength(1);
    expect(marker.getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(container.querySelector("svg")!);
    expect(onGap).toHaveBeenLastCalledWith(null);
    expect(container.querySelector('[data-testid="gap-card"]')).toBeNull();
  });

  it("openGap (a Gaps list row) opens that marker's card", () => {
    const { container, rerender } = render(<DrawnMap markers={[]} route={route} gaps={gaps} openGap="g3" onPick={() => undefined} />);
    expect(svgText(container)).toContain("Offline here");
    expect(svgText(container)).toContain("uploaded 14:20");
    rerender(<DrawnMap markers={[]} route={route} gaps={gaps} openGap={null} onPick={() => undefined} />);
    expect(container.querySelector('[data-testid="gap-card"]')).toBeNull();
  });

  it("one control cluster: zoom in, zoom out, trails (pressed while on), fit; no compass (this map never turns)", () => {
    const toggle = vi.fn();
    render(<DrawnMap markers={[]} route={route} gaps={gaps} trailsToggle={{ on: true, toggle }} onPick={() => undefined} />);
    const cluster = screen.getByTestId("map-controls");
    const names = [...cluster.querySelectorAll("button")].map((b) => b.getAttribute("aria-label"));
    expect(names).toEqual(["Zoom in", "Zoom out", "Today’s trails", "Fit everyone on the map"]);
    const trails = screen.getByRole("button", { name: "Today’s trails" });
    expect(trails.getAttribute("aria-pressed")).toBe("true");
    expect(trails.getAttribute("title")).toBe("Today’s trails");
    fireEvent.click(trails);
    expect(toggle).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: "Turn the map north up" })).toBeNull();
  });

  it("the plan: our pins numbered with their chips, no Google pin, straight connectors and the note; a tap calls onPin", () => {
    const onPin = vi.fn();
    const { container } = render(
      <DrawnMap
        markers={[]}
        route={null}
        plan={{
          pins: [
            { id: "s", n: "S", lat: 6.9, lng: 79.86, label: "S · Head office · 08:00" },
            { id: "p1", n: 1, lat: 7.2, lng: 80.0, label: "1 · Kurunegala site · 09:00–10:30", late: true },
            { id: "p2", n: 2, lat: 7.3, lng: 80.2, label: "2 · Google cafe · 11:00", google: true },
          ],
          lines: [[{ lat: 6.9, lng: 79.86 }, { lat: 7.2, lng: 80.0 }]],
          selected: "p1",
        }}
        onPin={onPin}
        height={300}
        onPick={() => undefined}
      />,
    );
    const pins = container.querySelectorAll('[data-testid="plan-pin"]');
    expect(pins).toHaveLength(2);
    expect(svgText(container)).not.toContain("Google cafe");
    expect(svgText(container)).toContain("Kurunegala site · 09:00–10:30");
    expect(pins[1].getAttribute("class")).toBe("plan-pin late sel");
    expect(container.querySelectorAll('[data-testid="plan-links"] polyline')).toHaveLength(1);
    expect(screen.getByTestId("map-note").textContent).toBe("Straight lines, not the road · 1 Google stop listed, not drawn");
    fireEvent.click(pins[0]);
    expect(onPin).toHaveBeenCalledWith("s");
    expect((container.firstChild as HTMLElement).style.height).toBe("300px");
    expect(screen.getByRole("button", { name: "Fit the plan on the map" })).toBeTruthy();
  });

  it("the playback marker: a hollow ring while estimated, turned to the path", () => {
    const { container } = render(<DrawnMap markers={[]} route={{ ...route, cursor: { lat: 7.25, lng: 80.15, label: "11:10:00", estimated: true, heading: 45 } }} onPick={() => undefined} />);
    const cursor = container.querySelector('[data-testid="drawn-cursor"]')!;
    expect(cursor.getAttribute("class")).toBe("cursor est");
    expect([...cursor.querySelectorAll("circle")].every((c) => c.getAttribute("fill") === "none")).toBe(true);
    expect(cursor.querySelector("polygon")!.getAttribute("transform")).toContain("rotate(45");
    expect(cursor.textContent).toBe("11:10:00");
  });
});
