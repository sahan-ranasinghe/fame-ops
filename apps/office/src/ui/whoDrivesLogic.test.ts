// Round 3: "Who drives?" — the words, the check and the arguments every request and task tool takes.
import { describe, expect, it } from "vitest";
import { askedOf, askedWords, emptyWho, needsPlate, plateReason, selfLabel, whoChoices, whoFromRequest, whoHint, whoInput } from "./whoDrivesLogic";

describe("Who drives? (Round 3)", () => {
  it("three choices; the second says whose request it is when an approver changes someone else's", () => {
    expect(whoChoices().map(([, w]) => w)).toEqual(["A driver", "I'll drive myself", "Someone else"]);
    expect(selfLabel("Sahan Ranasinghe", "Sahan Ranasinghe")).toBe("I'll drive myself");
    expect(selfLabel("Dilini Jayasinghe", "Palitha")).toBe("Dilini drives");
    expect(selfLabel(undefined, "Palitha")).toBe("I'll drive myself");
    expect(whoChoices("Dilini drives")[1][1]).toBe("Dilini drives");
  });

  it("sends nothing for a driver (the default), driven_by self, or someone else's name and phone", () => {
    expect(whoInput(emptyWho())).toEqual({ input: {} });
    expect(whoInput(emptyWho(), { always: true })).toEqual({ input: { driven_by: "driver" } });
    expect(whoInput({ by: "self", name: "kept", phone: "kept" })).toEqual({ input: { driven_by: "self" } });
    expect(whoInput({ by: "other", name: " Nimal Silva ", phone: " 077 123 4567 " })).toEqual({
      input: { driven_by: "other", driver_name: "Nimal Silva", driver_phone: "077 123 4567" },
    });
  });

  it("someone else needs a name and a Sri Lankan phone, said in words", () => {
    expect(whoInput({ by: "other", name: "", phone: "0771234567" })).toEqual({ error: "Someone else drives: type their name." });
    expect(whoInput({ by: "other", name: "Nimal", phone: "" })).toEqual({ error: "Someone else drives: type their phone, e.g. 077 123 4567, so the office can call them." });
    expect(whoInput({ by: "other", name: "Nimal", phone: "1234" })).toEqual({ error: "Their phone: Type a Sri Lankan number, e.g. 077 123 4567." });
    expect("input" in whoInput({ by: "other", name: "Nimal", phone: "+94 77 123 4567" })).toBe(true);
  });

  it("no driver of ours needs a plate, and says why", () => {
    expect([needsPlate("driver"), needsPlate("self"), needsPlate("other"), needsPlate("custodian"), needsPlate(undefined)]).toEqual([false, true, true, true, false]);
    expect(plateReason({ by: "self", name: "" })).toBe("You drive it: pick the vehicle (nobody confirms one on the day).");
    expect(plateReason({ by: "self", name: "" }, "Dilini drives")).toBe("Dilini drives it: pick the vehicle (nobody confirms one on the day).");
    expect(plateReason({ by: "other", name: "Nimal" })).toBe("Nimal drives it: pick the vehicle (nobody confirms one on the day).");
    expect(plateReason({ by: "other", name: " " })).toBe("Someone else drives it: pick the vehicle (nobody confirms one on the day).");
  });

  it("the hint under the choices", () => {
    expect(whoHint("driver")).toBe("");
    expect(whoHint("self", { picksVehicle: true })).toBe("You drive it yourself: no app and nothing is sent. Pick the vehicle below.");
    expect(whoHint("self")).toBe("You drive it yourself: no app and nothing is sent. The office picks the vehicle.");
    expect(whoHint("self", { selfWords: "Dilini drives" })).toMatch(/^They drive it themselves/);
    expect(whoHint("other")).toBe("Not in Fame Fleet: no app. The office calls them on this number.");
  });

  it("what a request asked, in words; the older driver_required false is the custodian", () => {
    expect(askedOf({})).toBe("driver");
    expect(askedOf({ driver_required: false })).toBe("custodian");
    expect(askedOf({ driven_by: "self", driver_required: false })).toBe("self");
    expect(askedWords({ driven_by: "self" })).toBe("Drives themselves");
    expect(askedWords({ driven_by: "other", driver_name: "Nimal", driver_phone: "+94771234567" }, (p) => `0${p.slice(3, 5)} ${p.slice(5, 8)} ${p.slice(8)}`)).toBe("Someone else: Nimal · 077 123 4567");
    expect(askedWords({ driver_required: false })).toBe("The custodian drives");
    expect(askedWords({ driver_required: true })).toBe("A driver");
    // The form takes the request's choice; the custodian path reads as a driver (the form no longer offers it).
    expect(whoFromRequest({ driven_by: "other", driver_name: "Nimal", driver_phone: "+94771234567" })).toEqual({ by: "other", name: "Nimal", phone: "+94771234567" });
    expect(whoFromRequest({ driver_required: false })).toEqual({ by: "driver", name: "", phone: "" });
  });
});
