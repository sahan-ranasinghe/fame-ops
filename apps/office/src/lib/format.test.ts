import { describe, expect, it } from "vitest";
import { addDays, latLng, num, plateOf, splitEqually, waLink, warnList } from "./format";

describe("format helpers", () => {
  it("reads the position out of a Google Maps link", () => {
    expect(latLng("https://www.google.com/maps/search/?api=1&query=6.9271,79.8612")).toEqual({ lat: 6.9271, lng: 79.8612 });
    expect(latLng("https://www.google.com/maps/dir/?api=1&destination=6.9%2C79.8")).toEqual({ lat: 6.9, lng: 79.8 });
    expect(latLng("https://www.google.com/maps/dir/?api=1&destination=Nugegoda")).toBeNull();
    expect(latLng(null)).toBeNull();
  });
  it("makes wa.me links with the Sri Lankan country code", () => {
    expect(waLink("0771234567")).toBe("https://wa.me/94771234567");
    expect(waLink("+94 77 123 4567", "Hi")).toBe("https://wa.me/94771234567?text=Hi");
    expect(waLink("")).toBe("");
  });
  it("splits 100% into whole numbers", () => {
    expect(splitEqually(3)).toEqual([34, 33, 33]);
    expect(splitEqually(4)).toEqual([25, 25, 25, 25]);
    expect(splitEqually(0)).toEqual([]);
  });
  it("adds days as calendar days", () => {
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });
  it("formats numbers and plates", () => {
    expect(num(1234.56)).toBe("1,234.6");
    expect(num(null)).toBe("—");
    expect(plateOf("WP CAB-4521 · Toyota HiAce")).toBe("WP CAB-4521");
  });
  it("collects warnings from a write's answer", () => {
    expect(warnList({ warnings: ["a", { message: "b" }] })).toEqual(["a", "b"]);
    expect(warnList({})).toEqual([]);
  });
});
