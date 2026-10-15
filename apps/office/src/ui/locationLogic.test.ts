import { describe, expect, it } from "vitest";
import { badgeTone, inLanka, looksPasted, pickedOf, pinText, shouldSearch } from "./locationLogic";
import { reportCsv } from "../screens/settings/ImportSites";

describe("the location search box", () => {
  it("asks from 2 characters, or at once for a pasted pin or link", () => {
    expect(shouldSearch("M")).toBe(false);
    expect(shouldSearch("MT")).toBe(true);
    expect(looksPasted("6.9271, 79.8612")).toBe(true);
    expect(looksPasted("https://maps.app.goo.gl/AbC")).toBe(true);
    expect(looksPasted("Kandy")).toBe(false);
    expect(looksPasted("0771234567")).toBe(false);
  });
  it("badges: office green, sites blue, the map amber, used before grey", () => {
    expect(badgeTone("Office")).toBe("ok");
    expect(badgeTone("Site · Dialog")).toBe("live");
    expect(badgeTone("Site · Mobitel")).toBe("live");
    expect(badgeTone("Map")).toBe("warn");
    expect(badgeTone("Used before")).toBe("muted");
    expect(badgeTone("Saved")).toBe("");
  });
  it("a pick: our place keeps its id; a place used before brings its pin only", () => {
    expect(pickedOf({ layer: "place", badge: "Site · Dialog", name: "Inamaluwa Town", id: "p1", pinned: false })).toEqual({ name: "Inamaluwa Town", placeId: "p1", lat: undefined, lng: undefined, pinned: false, badge: "Site · Dialog" });
    expect(pickedOf({ layer: "recent", badge: "Used before", name: "Kelaniya temple gate", pinned: true, lat: 6.95, lng: 79.92 }).placeId).toBeUndefined();
    expect(pinText({ lat: 6.9271, lng: 79.8612 })).toBe("6.927100, 79.861200");
    expect(inLanka(6.9, 79.9)).toBe(true);
    expect(inLanka(79.9, 6.9)).toBe(false);
  });
});

describe("the import report", () => {
  it("lists the file's skipped and repaired rows and the import's skipped rows as CSV", () => {
    const preview = { preset: "mobitel_ep" as const, rows: [], read: 3, with_pin: 0, no_pin: 0, skipped: [{ row: 5, reason: 'BAD1: no usable "coordinates"' }], repaired: [{ row: 3, note: "ZBAT44: latitude and longitude were swapped" }] };
    const csv = reportCsv(preview, { skipped: [{ row: "12", reason: "CM0164 is already an other id of MT0184" }] });
    expect(csv).toBe('what,row,reason\nskipped in the file,5,"BAD1: no usable ""coordinates"""\nrepaired,3,"ZBAT44: latitude and longitude were swapped"\nskipped on import,12,"CM0164 is already an other id of MT0184"\n');
  });
});
