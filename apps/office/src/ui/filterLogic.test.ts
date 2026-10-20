import { describe, expect, it } from "vitest";
import {
  activeChips,
  activeCount,
  choiceText,
  defaultsOf,
  type FilterDef,
  isChosen,
  listDef,
  narrowChoices,
  pairsDef,
  readFilters,
  removeChip,
  toggleChoice,
  writeFilters,
} from "./filterLogic";

const status = pairsDef("status", "Status", [["waiting", "Waiting"], ["approved", "Approved"], ["all", "All"]], "waiting", { waiting: 5 });
const kinds: FilterDef = { key: "kind", label: "Kind", kind: "multi", options: [{ value: "a", label: "Alpha" }, { value: "b", label: "Beta" }, { value: "c", label: "Gamma" }] };
const vehicle = listDef("vehicle", "Vehicle", "All vehicles", [{ value: "WP CAB-4521", label: "WP CAB-4521" }]);
const defs = [status, kinds, vehicle];
const url = (q: string) => new URLSearchParams(q);

describe("filters: the URL", () => {
  it("reads the values; missing or unknown ones are the default; an open filter keeps a link's value", () => {
    expect(readFilters(url(""), defs)).toEqual({ status: "waiting", kind: [], vehicle: "" });
    expect(readFilters(url("status=approved&kind=a,c&vehicle=WP+CAB-4521"), defs)).toEqual({ status: "approved", kind: ["a", "c"], vehicle: "WP CAB-4521" });
    expect(readFilters(url("status=nonsense&kind=x,b,b"), defs)).toEqual({ status: "waiting", kind: ["b"], vehicle: "" });
    // A vehicle from a link before the fleet's list has loaded (open).
    expect(readFilters(url("vehicle=NB-1111"), defs).vehicle).toBe("NB-1111");
  });

  it("writes the values, the defaults leave no trace, the other parameters stay", () => {
    expect(writeFilters(url("q=van&range=week"), defs, { status: "approved", kind: ["a", "b"], vehicle: "" }).toString()).toBe("q=van&range=week&status=approved&kind=a%2Cb");
    expect(writeFilters(url("status=approved&kind=a&q=van"), defs, defaultsOf(defs)).toString()).toBe("q=van");
    // A filter at an existing place keeps its place.
    expect(writeFilters(url("status=approved&q=van"), defs, { status: "all", kind: [], vehicle: "" }).toString()).toBe("status=all&q=van");
  });

  it("a multi filter whose default is not empty, emptied, says so (an empty parameter)", () => {
    const d: FilterDef = { ...kinds, default: ["a"] };
    expect(readFilters(url(""), [d]).kind).toEqual(["a"]);
    const w = writeFilters(url(""), [d], { kind: [] });
    expect(w.toString()).toBe("kind=");
    expect(readFilters(w, [d]).kind).toEqual([]);
  });
});

describe("filters: the chips and the count", () => {
  it("only the filters in use; a multi filter has a chip per value but counts once", () => {
    const v = { status: "approved", kind: ["a", "c"], vehicle: "WP CAB-4521" };
    expect(activeChips(defs, v).map((c) => c.text)).toEqual(["Status: Approved", "Kind: Alpha", "Kind: Gamma", "Vehicle: WP CAB-4521"]);
    expect(activeCount(defs, v)).toBe(3);
    expect(activeChips(defs, defaultsOf(defs))).toEqual([]);
    expect(activeCount(defs, defaultsOf(defs))).toBe(0);
  });

  it("removing a chip: a single filter back to its default, a multi filter loses that value", () => {
    const v = { status: "approved", kind: ["a", "c"], vehicle: "" };
    expect(removeChip(defs, v, { key: "status", value: "approved" }).status).toBe("waiting");
    expect(removeChip(defs, v, { key: "kind", value: "a" }).kind).toEqual(["c"]);
  });
});

describe("filters: the panel's draft", () => {
  it("a radio press picks one; a tick toggles a value", () => {
    expect(toggleChoice(status, "waiting", "approved")).toBe("approved");
    expect(toggleChoice(kinds, ["a"], "b")).toEqual(["a", "b"]);
    expect(toggleChoice(kinds, ["a", "b"], "a")).toEqual(["b"]);
    expect(isChosen(status, undefined, "waiting")).toBe(true);
    expect(isChosen(kinds, ["b"], "b")).toBe(true);
  });

  it("counts beside the choices; a long list narrowed by what is typed (plates without spaces or dashes)", () => {
    expect(choiceText(status.options[0])).toBe("Waiting · 5");
    expect(choiceText(status.options[1])).toBe("Approved");
    const plates = [{ value: "WP CAB-4521", label: "WP CAB-4521" }, { value: "NB-1111", label: "NB-1111" }];
    expect(narrowChoices(plates, "cab4521").map((o) => o.value)).toEqual(["WP CAB-4521"]);
    expect(narrowChoices(plates, "").length).toBe(2);
  });

  it("a list filter keeps a value it does not (yet) list, after its All choice", () => {
    const d = listDef("driver", "Driver", "All drivers", [{ value: "nuwan", label: "Nuwan" }], "kamal");
    expect(d.options.map((o) => o.value)).toEqual(["", "kamal", "nuwan"]);
  });
});
