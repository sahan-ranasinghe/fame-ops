import { describe, expect, it } from "vitest";
import { PHONE_MAP_MIN_PX, PHONE_MAP_SHARE, routeLayout, SPLIT_PANE_MIN_PX, splitPaneHeight } from "./routeLayout";

describe("the route page's layout (Round 48: Airbnb's split view, a fixed-height map on a phone)", () => {
  it("a desktop gets the split view (the map pane sticky, the details scrolling beside it)", () => {
    expect(routeLayout(false, 900)).toEqual({ kind: "split" });
  });
  it("a phone gets the map at 45 % of the viewport, at least 300 px, the content below", () => {
    expect(PHONE_MAP_SHARE).toBe(0.45);
    expect(PHONE_MAP_MIN_PX).toBe(300);
    expect(routeLayout(true, 915)).toEqual({ kind: "stacked", mapHeight: 412 });
    expect(routeLayout(true, 600)).toEqual({ kind: "stacked", mapHeight: 300 });
    expect(routeLayout(true, 0).mapHeight).toBe(360); // no height known: 800 × 0.45
  });
  it("a page that is itself a panel (the task page) stacks at every width", () => {
    expect(routeLayout(false, 900, true)).toEqual({ kind: "stacked", mapHeight: 405 });
  });
});

describe("the split pane's height (the map and the playback on screen together, whatever the scroll)", () => {
  it("follows the pane's current top: its own place on first load, 20 px once it sticks; never under the minimum", () => {
    expect(splitPaneHeight(900, 260)).toBe(620);
    expect(splitPaneHeight(900, 20)).toBe(860);
    expect(splitPaneHeight(900, -300)).toBe(860);
    expect(splitPaneHeight(500, 260)).toBe(SPLIT_PANE_MIN_PX);
    expect(splitPaneHeight(Number.NaN, Number.NaN)).toBe(760);
  });
});

