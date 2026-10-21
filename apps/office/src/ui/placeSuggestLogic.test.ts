import { describe, expect, it } from "vitest";
import { splitSuggestions, WHERE_MAX_RECENT, WHERE_MAX_ROWS, whereRows } from "./placeSuggestLogic";

const P = (name: string) => ({ layer: "place", name });
const R = (name: string) => ({ layer: "recent", name });
const T = (name: string) => ({ layer: "town", name });
const names = (rows: { item: { name: string } }[]) => rows.map((r) => r.item.name);

describe("Where suggestions (Round 1 item 6)", () => {
  it("5 rows at most: ours first, then 3 recent; a recent one of ours shows once; no towns", () => {
    const { ours, recent } = splitSuggestions([R("Kandy"), R("Galle"), R("Head office"), R("Jaffna"), R("Matara"), P("Head office"), P("A"), P("B"), P("C"), T("Kegalle")]);
    const w = whereRows(ours, recent, (r) => r.name);
    expect(WHERE_MAX_ROWS).toBe(5);
    expect(WHERE_MAX_RECENT).toBe(3);
    expect(names(w.top)).toEqual(["Head office", "A", "Kandy", "Galle", "Jaffna"]);
    expect(w.top.map((r) => r.icon)).toEqual(["building", "building", "clock", "clock", "clock"]);
    expect(names(w.more)).toEqual(["B", "C", "Matara"]);
    expect([...w.top, ...w.more].some((r) => r.item.layer === "town")).toBe(false);
  });

  it("fewer: fewer rows, nothing more", () => {
    const w = whereRows([P("Head office")], [R("Kandy")], (r) => r.name);
    expect(names(w.top)).toEqual(["Head office", "Kandy"]);
    expect(w.more).toEqual([]);
  });

  it("only ours: 5 of them, the rest under More places", () => {
    const w = whereRows(["1", "2", "3", "4", "5", "6", "7"].map(P), [], (r) => r.name);
    expect(w.top).toHaveLength(5);
    expect(names(w.more)).toEqual(["6", "7"]);
  });
});
