import { describe, expect, it } from "vitest";
import { CLUSTER_CELL_PX, clusterItems, clusterLabel, clusterTitle, meanOf } from "./cluster";

describe("clusterItems (Round 48: MarkerClusterer's grid, shared by the three maps)", () => {
  it("marks in one grid cell become one cluster at their mean; a mark alone in its cell stays single", () => {
    const out = clusterItems([
      { id: "a", x: 10, y: 10 },
      { id: "b", x: 20, y: 30 },
      { id: "c", x: 400, y: 400 },
    ]);
    expect(out.singles).toEqual(["c"]);
    expect(out.clusters).toEqual([{ id: "cluster:a|b", x: 15, y: 20, ids: ["a", "b"] }]);
  });
  it("the cell is 48 px by default: two marks 47 px apart in one cell cluster, in the next cell they do not", () => {
    expect(CLUSTER_CELL_PX).toBe(48);
    expect(clusterItems([{ id: "a", x: 0, y: 0 }, { id: "b", x: 47, y: 0 }]).clusters).toHaveLength(1);
    expect(clusterItems([{ id: "a", x: 0, y: 0 }, { id: "b", x: 48, y: 0 }]).clusters).toHaveLength(0);
    // Another cell size (the drawn map's SVG units).
    expect(clusterItems([{ id: "a", x: 0, y: 0 }, { id: "b", x: 50, y: 0 }], { cell: 56 }).clusters).toHaveLength(1);
  });
  it("the open mark is kept single and never counted; a mark without a position is single", () => {
    const out = clusterItems([{ id: "a", x: 1, y: 1 }, { id: "b", x: 2, y: 2 }, { id: "c", x: 3, y: 3 }, { id: "d", x: NaN, y: 1 }], { keep: ["b"] });
    expect(out.singles).toEqual(["b", "d"]);
    expect(out.clusters[0].ids).toEqual(["a", "c"]);
  });
  it("the singles keep the input order; nothing to cluster gives everything single", () => {
    const out = clusterItems([{ id: "z", x: 500, y: 0 }, { id: "y", x: 0, y: 500 }, { id: "x", x: 0, y: 0 }]);
    expect(out.singles).toEqual(["z", "y", "x"]);
    expect(out.clusters).toEqual([]);
    expect(clusterItems([])).toEqual({ singles: [], clusters: [] });
  });
  it("the label and the name", () => {
    expect(clusterLabel(3)).toBe("3");
    expect(clusterLabel(120)).toBe("99+");
    expect(clusterTitle(12)).toBe("12 marks here · zoom in to see them");
    expect(meanOf([{ lat: 6, lng: 79 }, { lat: 8, lng: 81 }])).toEqual({ lat: 7, lng: 80 });
  });
});
