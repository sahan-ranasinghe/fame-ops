import { describe, expect, it } from "vitest";
import * as logic from "./timeLogic";
import { isWholeTime, nowExact, parseTyped } from "./timeLogic";

describe("time rules", () => {
  it("now to the minute in Colombo (UTC+5:30), where the clock starts", () => {
    expect(nowExact(new Date("2026-10-20T05:11:00Z"))).toBe("10:41");
    expect(nowExact(new Date("2026-10-20T18:29:30Z"))).toBe("23:59");
    expect(nowExact(new Date("2026-10-20T18:30:00Z"))).toBe("00:00");
    expect(isWholeTime(nowExact())).toBe(true);
  });

  it("typed text: the hour, hour and minutes, with or without a separator; anything else refused", () => {
    expect(parseTyped("")).toBe("");
    expect(parseTyped("  ")).toBe("");
    expect(parseTyped("9")).toBe("09:00");
    expect(parseTyped("09")).toBe("09:00");
    expect(parseTyped("930")).toBe("09:30");
    expect(parseTyped("0930")).toBe("09:30");
    expect(parseTyped("1415")).toBe("14:15");
    expect(parseTyped("9:30")).toBe("09:30");
    expect(parseTyped("9.30")).toBe("09:30");
    expect(parseTyped("14:00")).toBe("14:00");
    expect(parseTyped("24:00")).toBeNull();
    expect(parseTyped("9:75")).toBeNull();
    expect(parseTyped("noon")).toBeNull();
    expect(parseTyped("12345")).toBeNull();
  });

  it("no quick-time chips any more (the boss's review, 21 October 2026: the clock only)", () => {
    expect(Object.keys(logic)).not.toContain("sheetChips");
    expect(Object.keys(logic)).not.toContain("COMMON_TIMES");
  });
});
