import { BUILT_IN } from "@fleet/sites";
import { describe, expect, it } from "vitest";
import type { ImportPreset } from "../../data/types";
import { guessMapping, presetKeyFor, problemRows, sameMapping } from "./importLogic";

describe("the site import page", () => {
  it("guesses the mapping from the column names", () => {
    expect(guessMapping(["Code", "Location name", "GPS", "Owner", "Type", "Address", "District"], 3)).toEqual({
      header_row: 3,
      columns: { site_id: "Code", name: "Location name", latlng: "GPS", operator: "Owner", kind: "Type", address: "Address", district: "District" },
    });
    // Dialog's own sheet: the new region over the old one, two coordinate columns, no operator column (one value).
    const dialog = guessMapping(["Inclution Date to this sheet", "Site ID", "Other Site IDS", "Site Name", "Region", "New Region", "District", "Depot", "Depot officer", "Latitude", "Longitude"]);
    expect(dialog.columns).toEqual({ site_id: "Site ID", other_ids: "Other Site IDS", name: "Site Name", region: "New Region", district: "District", depot: "Depot", lat: "Latitude", lng: "Longitude" });
    expect(dialog.operator).toBe("other");
  });
  it("records the preset's key while its mapping is unchanged, else custom", () => {
    const dialog: ImportPreset = { key: "dialog", name: "Dialog site list", built_in: true, mapping: BUILT_IN.dialog.mapping };
    expect(presetKeyFor(dialog, { ...BUILT_IN.dialog.mapping, sheet: "Another sheet name" })).toEqual({ key: "dialog", label: "Dialog site list" });
    expect(presetKeyFor(dialog, { ...BUILT_IN.dialog.mapping, columns: { ...BUILT_IN.dialog.mapping.columns, depot: undefined } })).toEqual({ key: "custom", label: "Dialog site list (changed)" });
    expect(presetKeyFor(null, { header_row: 1, columns: { name: "Name" }, operator: "other" })).toEqual({ key: "custom", label: "Custom mapping" });
    expect(sameMapping({ header_row: 1, columns: { name: "A", lat: undefined } }, { header_row: 1, columns: { name: "A" } })).toBe(true);
  });
  it("lists the first problem rows, skipped and repaired together by row", () => {
    const rows = problemRows([{ row: 9, reason: "X: outside Sri Lanka" }, { row: 4, reason: "KL1 appears twice" }], [{ row: 5, note: "KL2: latitude and longitude were swapped" }], 2);
    expect(rows).toEqual([{ row: 4, text: "KL1 appears twice", repaired: false }, { row: 5, text: "KL2: latitude and longitude were swapped", repaired: true }]);
  });
});
