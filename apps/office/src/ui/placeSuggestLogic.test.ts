import { describe, expect, it } from "vitest";
import { groupedWhere, someoneElsesRequest, startsGroup, suggestArgs, type SuggestForWhom, splitSuggestions, SUGGEST_MAX_ROWS, WHERE_MAX_RECENT, WHERE_MAX_ROWS, whereRows } from "./placeSuggestLogic";

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

describe("Where suggestions in groups (Round 4–7, item 10)", () => {
  const G = (name: string, layer: string, group: string, group_label: string) => ({ layer, name, group, group_label });
  const answer = [
    G("Head office", "place", "saved", "Saved"), G("Store A", "place", "saved", "Saved"),
    G("Kandy depot", "recent", "recent", "Recent"), G("Galle site", "recent", "recent", "Recent"),
    G("Matara", "recent", "for", "Anoja's recent"), G("Head office", "recent", "for", "Anoja's recent"),
    { layer: "town", name: "Kegalle" },
  ];

  it("Saved, Recent, then <Name>'s recent, each under its header; a name shown once; no towns", () => {
    const w = groupedWhere(answer, (r) => r.name);
    expect(names(w.top)).toEqual(["Head office", "Store A", "Kandy depot", "Galle site", "Matara"]);
    expect(w.top.map((r) => [r.group, r.label, r.icon])).toEqual([
      ["saved", "Saved", "building"], ["saved", "Saved", "building"],
      ["recent", "Recent", "clock"], ["recent", "Recent", "clock"],
      ["for", "Anoja's recent", "clock"],
    ]);
    expect(w.top.map((_, i) => startsGroup(w.top, i))).toEqual([true, false, true, false, true]);
    expect(w.more).toEqual([]);
  });

  it("the order is the groups', whatever order the rows come in; more than 7 go under More places", () => {
    const many = [
      ...["R1", "R2", "R3"].map((n) => G(n, "recent", "recent", "Recent")),
      ...["S1", "S2", "S3", "S4", "S5", "S6"].map((n) => G(n, "place", "saved", "Saved")),
    ];
    const w = groupedWhere(many, (r) => r.name);
    expect(SUGGEST_MAX_ROWS).toBe(7);
    expect(names(w.top)).toEqual(["S1", "S2", "S3", "S4", "S5", "S6", "R1"]);
    expect(names(w.more)).toEqual(["R2", "R3"]);
  });

  it("an answer without groups (an older server): ours then 3 recent as before, no headers", () => {
    const w = groupedWhere([R("Kandy"), R("Galle"), P("Head office"), P("A")], (r) => r.name);
    expect(names(w.top)).toEqual(["Head office", "A", "Kandy", "Galle"]);
    expect(w.top.some((r) => r.group)).toBe(false);
    expect(w.top.map((_, i) => startsGroup(w.top, i)).some(Boolean)).toBe(false);
  });

  it("for someone else's request; nothing extra for one's own; never for_person (the server took it away)", () => {
    expect(suggestArgs(null)).toEqual({ suggest: true });
    expect(suggestArgs({ request: "r-1" })).toEqual({ suggest: true, for_request: "r-1" });
    expect(suggestArgs({ person: "e-1" } as unknown as SuggestForWhom)).toEqual({ suggest: true });
  });

  it("someone else's request: by id when both sides carry one, else by name", () => {
    expect(someoneElsesRequest({ requested_by: "Anoja Perera" }, { name: "Sahan Ranasinghe" })).toBe(true);
    expect(someoneElsesRequest({ requested_by: "Sahan Ranasinghe" }, { name: "Sahan Ranasinghe" })).toBe(false);
    expect(someoneElsesRequest({ requested_by: " Sahan Ranasinghe" }, { name: "Sahan Ranasinghe " })).toBe(false);
    // Two people with one name: the ids tell them apart; the same person under another spelling is still their own.
    expect(someoneElsesRequest({ requested_by: "Kamal Silva", requested_by_employee_id: "e-2" }, { name: "Kamal Silva", employee_id: "e-1" })).toBe(true);
    expect(someoneElsesRequest({ requested_by: "K. Silva", requested_by_employee_id: "e-1" }, { name: "Kamal Silva", employee_id: "e-1" })).toBe(false);
    // Only one side has an id: the name decides.
    expect(someoneElsesRequest({ requested_by: "Kamal Silva", requested_by_employee_id: "e-2" }, { name: "Kamal Silva" })).toBe(false);
  });
});
