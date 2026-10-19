import { describe, expect, it } from "vitest";
import { pinChip, planFitKey, planFor, planPoints } from "./planDraw";
import type { MapPlan, PlanPin } from "./types";

const pin = (id: string, n: number | "S", lat: number, lng: number, extra: Partial<PlanPin> = {}): PlanPin => ({ id, n, lat, lng, label: `${n} · ${id} · 09:00–10:30`, ...extra });
const plan: MapPlan = {
  pins: [
    pin("start", "S", 6.9, 79.86),
    pin("a", 1, 7.2, 80.0),
    pin("g", 2, 7.3, 80.2, { google: true }),
    pin("b", 3, 7.48, 80.36, { late: true }),
  ],
  lines: [[{ lat: 6.9, lng: 79.86 }, { lat: 7.0, lng: 79.9 }, { lat: 7.2, lng: 80.0 }], [{ lat: 7.2, lng: 80.0 }, { lat: 7.3, lng: 80.2 }], [{ lat: 7.3, lng: 80.2 }, { lat: 7.48, lng: 80.36 }]],
  selected: null,
};

describe("the plan on a map that is not Google's (§20, rule 10)", () => {
  const d = planFor(plan, false);

  it("leaves Google's pin out and never draws Google's lines", () => {
    expect(d.pins.map((p) => p.id)).toEqual(["start", "a", "b"]);
    expect(d.pins.some((p) => p.google)).toBe(false);
    expect(d.lines).toEqual([]);
    expect(planPoints(d)).toEqual([{ lat: 6.9, lng: 79.86 }, { lat: 7.2, lng: 80.0 }, { lat: 7.48, lng: 80.36 }]);
  });

  it("joins neighbours with straight connectors; the Google stop breaks the chain (no leg straight past it)", () => {
    expect(d.links.map(([a, b]) => `${a.id}>${b.id}`)).toEqual(["start>a"]);
    expect(d.hidden).toBe(1);
    expect(d.note).toBe("Straight lines, not the road · 1 Google stop listed, not drawn");
  });

  it("our pins only: every neighbour joined, the note says they are not the road", () => {
    const ours = planFor({ pins: [pin("s", "S", 6.9, 79.86), pin("x", 1, 7.2, 80.0), pin("y", 2, 7.4, 80.3)], lines: plan.lines }, false);
    expect(ours.links.map(([a, b]) => `${a.id}>${b.id}`)).toEqual(["s>x", "x>y"]);
    expect(ours.lines).toEqual([]);
    expect(ours.note).toBe("Straight lines, not the road");
  });

  it("only Google stops: nothing drawn, the list says so", () => {
    const d2 = planFor({ pins: [pin("g1", 1, 7, 80, { google: true }), pin("g2", 2, 7.1, 80.1, { google: true })] }, false);
    expect(d2.pins).toEqual([]);
    expect(d2.links).toEqual([]);
    expect(d2.note).toBe("2 Google stops listed, not drawn");
    expect(planFitKey(d2)).toBe("");
  });

  it("no plan: nothing", () => {
    expect(planFor(null, false)).toEqual({ pins: [], links: [], lines: [], hidden: 0, note: null });
    expect(planFor({ pins: [] }, true).note).toBeNull();
  });
});

describe("the plan on Google's map", () => {
  it("every pin (Google's too) and Google's line of each leg, no connectors, no note", () => {
    const d = planFor(plan, true);
    expect(d.pins.map((p) => p.id)).toEqual(["start", "a", "g", "b"]);
    expect(d.lines).toHaveLength(3);
    expect(d.links).toEqual([]);
    expect(d.note).toBeNull();
    expect(planPoints(d)).toHaveLength(4 + 7);
  });

  it("no stored line (an old plan, the estimate): straight connectors with the note", () => {
    const d = planFor({ ...plan, lines: undefined }, true);
    expect(d.links.map(([a, b]) => `${a.id}>${b.id}`)).toEqual(["start>a", "a>g", "g>b"]);
    expect(d.note).toBe("Straight lines, not the road");
  });
});

describe("fitting and chips", () => {
  it("the view is fitted again when the pins move, never on a highlight", () => {
    const key = planFitKey(planFor(plan, false));
    expect(planFitKey(planFor({ ...plan, selected: "a" }, false))).toBe(key);
    const moved = { ...plan, pins: plan.pins.map((p) => (p.id === "b" ? { ...p, lat: 7.6 } : p)) };
    expect(planFitKey(planFor(moved, false))).not.toBe(key);
    expect(planFitKey(planFor(plan, true))).not.toBe(planFitKey(planFor({ ...plan, lines: [] }, true)));
  });

  it("the chip does not repeat the number the pin shows", () => {
    expect(pinChip(pin("Kurunegala site", 2, 7, 80))).toBe("Kurunegala site · 09:00–10:30");
    expect(pinChip({ id: "s", n: "S", lat: 0, lng: 0, label: "S · Head office · 08:00" })).toBe("Head office · 08:00");
    expect(pinChip({ id: "x", n: 3, lat: 0, lng: 0, label: "Depot" })).toBe("Depot");
  });
});

describe("Part 6: leg by leg (Sahan, 19 October: the free map like the phones)", () => {
  const a = { lat: 6.9, lng: 79.86 }, b = { lat: 7.2, lng: 80.0 }, c = { lat: 7.48, lng: 80.36 };
  const legPlan: MapPlan = {
    pins: [pin("start", "S", a.lat, a.lng), pin("a", 1, b.lat, b.lng), pin("b", 2, c.lat, c.lng)],
    legs: [
      { from: "start", to: "a", points: [a, { lat: 7.0, lng: 79.9 }, b], google: false },
      { from: "a", to: "b", points: [b, c], google: true },
      { from: "b", to: "base", points: [c, a], google: true },
    ],
    selected: null,
  };
  it("the free map: openrouteservice's line drawn; a Google leg becomes a dashed straight connector; never Google's line", () => {
    const d = planFor(legPlan, false);
    expect(d.lines).toEqual([[a, { lat: 7.0, lng: 79.9 }, b]]);
    expect(d.links.map(([x, y]) => `${x.id}>${y.id}`)).toEqual(["a>b"]);
    expect(d.lines.flat().some((q) => q.lat === c.lat && q.lng === c.lng)).toBe(false);
    expect(d.note).toBe("Straight lines, not the road");
  });
  it("Google's map: every leg's line, no connector", () => {
    const d = planFor(legPlan, true);
    expect(d.lines).toHaveLength(3);
    expect(d.links).toEqual([]);
    expect(d.note).toBeNull();
  });
  it("a leg with no line at all (the estimate): a connector on either map", () => {
    const none: MapPlan = { ...legPlan, legs: legPlan.legs!.map((l) => ({ ...l, points: [] })) };
    expect(planFor(none, true).links.map(([x, y]) => `${x.id}>${y.id}`)).toEqual(["start>a", "a>b"]);
    expect(planFor(none, false).links.map(([x, y]) => `${x.id}>${y.id}`)).toEqual(["start>a", "a>b"]);
  });
});

