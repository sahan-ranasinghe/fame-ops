import { describe, expect, it } from "vitest";
import { askLink, readAskLink } from "./askLink";

describe("askLink", () => {
  it("builds the Ask page's link and reads it back", () => {
    const link = askLink({ kind: "free_for_trip", drivers: ["kamal", "nuwan.p"], date: "2026-10-20", from: "09:00", to: "12:00", task: "t1" });
    expect(link).toBe("/drivers/ask?kind=free_for_trip&drivers=kamal%2Cnuwan.p&date=2026-10-20&from=09%3A00&to=12%3A00&task=t1");
    expect(readAskLink(new URLSearchParams(link.split("?")[1]))).toEqual({
      kind: "free_for_trip",
      drivers: ["kamal", "nuwan.p"],
      allFree: false,
      date: "2026-10-20",
      from: "09:00",
      to: "12:00",
      task: "t1",
      request: undefined,
    });
  });
  it("leaves out what it does not know, and ignores bad values", () => {
    expect(askLink()).toBe("/drivers/ask");
    expect(askLink({ allFree: true })).toBe("/drivers/ask?all_free=1");
    expect(readAskLink(new URLSearchParams("kind=chat&date=20-10&from=9"))).toMatchObject({ kind: undefined, date: undefined, from: undefined, drivers: [] });
  });
});
