import { describe, expect, it } from "vitest";
import { COMMON_TIMES, isWholeTime, nearestStep, nowRounded, parseTyped, sheetChips, timeSteps } from "./timeLogic";

describe("time rules", () => {
  it("5-minute steps: 288 a day, from 00:00 to 23:55", () => {
    const s = timeSteps();
    expect(s).toHaveLength(288);
    expect(s[0]).toBe("00:00");
    expect(s[1]).toBe("00:05");
    expect(s[s.length - 1]).toBe("23:55");
    expect(s.every(isWholeTime)).toBe(true);
  });

  it("Now is rounded up to the next 5 minutes in Colombo (UTC+5:30), never past 23:55", () => {
    expect(nowRounded(new Date("2026-10-20T05:11:00Z"))).toBe("10:45"); // 10:41
    expect(nowRounded(new Date("2026-10-20T05:15:00Z"))).toBe("10:45"); // 10:45 stays
    expect(nowRounded(new Date("2026-10-20T05:15:30Z"))).toBe("10:45"); // seconds do not count
    expect(nowRounded(new Date("2026-10-20T05:16:00Z"))).toBe("10:50");
    expect(nowRounded(new Date("2026-10-20T18:28:00Z"))).toBe("23:55"); // 23:58
    expect(nowRounded(new Date("2026-10-20T18:30:00Z"))).toBe("00:00"); // midnight
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

  it("the list scrolls to the nearest step (the value, else now)", () => {
    expect(nearestStep("07:24", "10:45")).toBe("07:25");
    expect(nearestStep("07:22", "10:45")).toBe("07:20");
    expect(nearestStep("", "10:45")).toBe("10:45");
    expect(nearestStep("23:58", "10:45")).toBe("23:55");
  });

  it("the chips: the planned time first, Now as its own choice, then every common time (21 October 2026)", () => {
    const c = sheetChips("09:00", "07:24");
    expect(c.map((x) => x.label)).toEqual(["Planned 07:24", "Now · 09:00", "08:00", "09:00", "12:00", "13:00", "17:00"]);
    expect(sheetChips("10:45").map((x) => x.time)).toEqual(["10:45", ...COMMON_TIMES]);
    // At 08:56–09:00 "Now" is 09:00: the 09:00 chip stays (an office person picking 09:00 then finds it).
    for (const now of [nowRounded(new Date("2026-10-21T03:18:00Z")), nowRounded(new Date("2026-10-21T03:29:00Z")), nowRounded(new Date("2026-10-21T18:28:00Z")), nowRounded(new Date("2026-10-21T18:31:00Z"))]) {
      const chips = sheetChips(now);
      expect(chips.filter((x) => x.kind === "common").map((x) => x.time)).toEqual([...COMMON_TIMES]);
      expect(chips.filter((x) => x.kind === "now")).toHaveLength(1);
    }
  });
});
