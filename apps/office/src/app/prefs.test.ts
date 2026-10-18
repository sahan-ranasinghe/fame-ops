import { describe, expect, it } from "vitest";
import { prefsOnServer, storageKey, toggled } from "./prefs";

describe("a person's page preferences (Hotfix 3, L1 and L5)", () => {
  it("on the server for a signed-in person with the tool; in this browser in the artifact or without it", () => {
    expect(prefsOnServer({ tools: ["my_prefs"] }, "api")).toBe(true);
    expect(prefsOnServer({ tools: ["my_prefs"] }, "claude")).toBe(false);
    expect(prefsOnServer({ tools: [] }, "api")).toBe(false);
    expect(prefsOnServer({ tools: ["my_prefs"] }, "api", true)).toBe(false);
  });
  it("a collapsed list: each key once, added at the end, taken out when opened", () => {
    expect(toggled(undefined, "road", true)).toEqual(["road"]);
    expect(toggled(["road"], "road", true)).toEqual(["road"]);
    expect(toggled(["road", "attention"], "road", false)).toEqual(["attention"]);
    expect(toggled(["attention"], "tiles", true)).toEqual(["attention", "tiles"]);
  });
  it("one copy per person in a browser; one for the artifact", () => {
    expect(storageKey({ email: "Sahan@Fame.test" })).toBe("fame-fleet.prefs:sahan@fame.test");
    expect(storageKey({})).toBe("fame-fleet.prefs");
  });
});
