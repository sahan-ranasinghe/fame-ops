// The clock's math is one file in two places (the app's lib/patterns/dialLogic.ts and this one): kept byte-identical, as
// notificationGroups.ts is; the app's scripts/test-patterns.ts tests the math, this checks it on the site too.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { hhmm, hourAt, minuteAt, pointOf } from "./dialLogic";

describe("the clock's math", () => {
  it("is the same file as the app's", () => {
    expect(readFileSync(join(__dirname, "dialLogic.ts"), "utf8")).toBe(readFileSync(join(__dirname, "../../../driver/src/lib/patterns/dialLogic.ts"), "utf8"));
  });
  it("reads the rings and every minute", () => {
    const at = (a: number, r: number) => pointOf(a, r, 132, 132);
    expect(hourAt(at(90, 108).x, at(90, 108).y, 132, 132, 108, 72)).toBe(3);
    expect(hourAt(at(150, 72).x, at(150, 72).y, 132, 132, 108, 72)).toBe(17);
    expect(minuteAt(at(42, 108).x, at(42, 108).y, 132, 132)).toBe(7);
    expect(hhmm(24, 61)).toBe("00:01");
  });
});
