// Hotfix 2's pure rules on the office site: phone numbers (F), the vehicle on the day (J), who decided and who is
// reviewing (K), and the links of an older answer.
import { describe, expect, it } from "vitest";
import { linksFromCall } from "../ui/phoneLinks";
import { callWho, decidedText, personLinks, reviewingText } from "./approversLogic";
import { decisionInput } from "./requestLogic";
import { officePhoneValue, phoneE164, profileInput, samePhone } from "./settings/profileLogic";
import { updateInput } from "./settings/usersLogic";
import { anyValue, choiceLabel, isChoice, knownDef, ON_THE_DAY, shownVehicle, vehicleArg, vehicleDefault, vehicleWords } from "./vehicleChoiceLogic";

describe("phone numbers (F)", () => {
  it("takes 07…, 7…, 94…, +94… and 0094… as +94 and nine digits; refuses anything else", () => {
    for (const t of ["077 123 4567", "0771234567", "771234567", "94771234567", "+94 77 123 4567", "0094771234567", "(077) 123-4567"]) {
      expect(phoneE164(t)).toBe("+94771234567");
    }
    expect(phoneE164("011 234 5678")).toBe("+94112345678");
    expect(phoneE164("")).toBeNull();
    expect(phoneE164("   ")).toBeNull();
    expect(phoneE164("077 123")).toBe("bad");
    expect(phoneE164("call me")).toBe("bad");
    expect(phoneE164("+1 415 555 0100")).toBe("bad");
  });

  it("the same number written either way is no change", () => {
    expect(samePhone("077 123 4567", "+94771234567")).toBe(true);
    expect(samePhone("", null)).toBe(true);
    expect(samePhone("077 123 4568", "+94771234567")).toBe(false);
    expect(profileInput("077 123 4567", "+94771234567")).toEqual({ nothing: true });
    expect(profileInput(" 0771234568 ", "+94771234567")).toEqual({ input: { phone: "0771234568" } });
    expect(profileInput("", "+94771234567")).toEqual({ input: { phone: null } });
    expect(profileInput("", undefined)).toEqual({ nothing: true });
  });

  it("the office number is saved as +94…, cleared with nothing, refused in words otherwise", () => {
    expect(officePhoneValue("011 234 5678")).toEqual({ value: "+94112345678" });
    expect(officePhoneValue("")).toEqual({ value: null });
    expect(officePhoneValue("12")).toEqual({ error: "Type a Sri Lankan number, e.g. 077 123 4567." });
  });

  it("an admin's edit sends the phone only when it is another number", () => {
    const before = { email: "a@fame.test", name: "Ann", phone: "+94771234567", permissions: ["view"] as const };
    expect(updateInput(before, { name: "Ann", email: "a@fame.test", phone: "077 123 4567", permissions: ["view"] })).toEqual({ nothing: true });
    expect(updateInput(before, { name: "Ann", email: "a@fame.test", phone: "077 999 4567", permissions: ["view"] })).toEqual({ input: { email: "a@fame.test", phone: "077 999 4567" } });
    expect(updateInput(before, { name: "Ann", email: "a@fame.test", phone: "", permissions: ["view"] })).toEqual({ input: { email: "a@fame.test", phone: null } });
  });

  it("an older answer's tel: and wa.me links become Call and WhatsApp", () => {
    expect(linksFromCall({ call: "tel:0779876543", whatsapp: "https://wa.me/94779876543" })).toEqual({
      phone: "+94779876543", phone_display: "077 987 6543", call: "tel:0779876543", whatsapp: "https://wa.me/94779876543",
    });
    expect(linksFromCall({ phone: "0771234567" })).toEqual({ phone: "+94771234567", phone_display: "077 123 4567", call: "tel:+94771234567", whatsapp: "https://wa.me/94771234567" });
    expect(linksFromCall({})).toBeNull();
    expect(linksFromCall(undefined)).toBeNull();
  });
});

describe("the vehicle on the day (J)", () => {
  const kamal = { reg_no: "WP CAB-4521", why: "Kamal's vehicle today" };
  const today = "2026-10-18";

  it("the default: a later day leaves it to the day; today the driver's vehicle, else the day; off as before", () => {
    expect(vehicleDefault({ on: true, date: "2026-10-20", today, driver: "kamal", def: kamal })).toMatchObject({ kind: "on_the_day" });
    expect(vehicleDefault({ on: true, date: "2026-10-20", today, driver: "", def: null })).toMatchObject({ kind: "on_the_day" });
    expect(vehicleDefault({ on: true, date: today, today, driver: "kamal", def: kamal })).toEqual({ kind: "plate", ...kamal });
    expect(vehicleDefault({ on: true, date: today, today, driver: "nuwan", def: null })).toMatchObject({ kind: "on_the_day" });
    expect(vehicleDefault({ on: true, date: today, today, driver: "", def: null })).toBeNull();
    // Not known yet (Who's available still loading): no default, so it never shows the day and then jumps to a plate.
    expect(vehicleDefault({ on: true, date: today, today, driver: "nuwan", def: undefined })).toBeNull();
    expect(knownDef(null, false)).toBeUndefined();
    expect(knownDef(null, true)).toBeNull();
    expect(knownDef(kamal, false)).toEqual(kamal);
    // Off: exactly as before (the driver's vehicle on any day; none known = none).
    expect(vehicleDefault({ on: false, date: "2026-10-20", today, driver: "kamal", def: kamal })).toEqual({ kind: "plate", ...kamal });
    expect(vehicleDefault({ on: false, date: today, today, driver: "nuwan", def: null })).toBeNull();
  });

  it("what is sent and shown: the pick, else the words for the day; a plate default is left to the server", () => {
    const day = vehicleDefault({ on: true, date: "2026-10-20", today, driver: "kamal", def: kamal });
    const plate = vehicleDefault({ on: true, date: today, today, driver: "kamal", def: kamal });
    expect(vehicleArg("", day)).toBe(ON_THE_DAY);
    expect(vehicleArg("any van", day)).toBe("any van");
    expect(vehicleArg("", plate)).toBe("");
    expect(vehicleArg("WP KL-1234", plate)).toBe("WP KL-1234");
    expect(shownVehicle("", day)).toBe(ON_THE_DAY);
    expect(shownVehicle("", plate)).toBe("WP CAB-4521");
    expect(shownVehicle("", null)).toBe("");
  });

  it("the words", () => {
    expect(anyValue("double_cab")).toBe("any double cab");
    expect(choiceLabel("any double cab")).toBe("Any double cab");
    expect(choiceLabel(ON_THE_DAY)).toBe("Driver's vehicle on the day");
    expect(choiceLabel("WP CAB-4521")).toBe("WP CAB-4521");
    expect(isChoice("any van")).toBe(true);
    expect(isChoice("WP CAB-4521")).toBe(false);
    expect(vehicleWords({ vehicle_text: "Vehicle: on the day" })).toBe("Vehicle: on the day");
    expect(vehicleWords({ vehicle: "WP CAB-4521", vehicle_text: "x" })).toBe("WP CAB-4521");
  });
});

describe("who decided, who is reviewing (K)", () => {
  it("names the others reviewing", () => {
    expect(reviewingText([{ name: "Palitha" }])).toBe("Palitha is reviewing");
    expect(reviewingText([{ name: "Palitha" }, { name: "Nimal" }])).toBe("Palitha and Nimal are reviewing");
    expect(reviewingText([{ name: "Palitha" }, { name: "Nimal" }, { name: "Sahan" }])).toBe("Palitha, Nimal and Sahan are reviewing");
    expect(reviewingText([{ name: "Sahan" }], "Sahan")).toBeNull();
    expect(reviewingText([])).toBeNull();
    expect(reviewingText(undefined)).toBeNull();
  });

  it("says who decided and when, with the reason", () => {
    expect(decidedText("approved", { name: "Palitha", at: "10:42" })).toBe("Approved by Palitha · 10:42");
    expect(decidedText("declined", { name: "Nimal", at: "Sat 17 Oct 10:50" }, "no van that day")).toBe("Declined by Nimal · Sat 17 Oct 10:50 · no van that day");
  });

  it("calls the person who decided, else the office", () => {
    const office = { phone: "+94112345678", phone_display: "011 234 5678", call: "tel:+94112345678", whatsapp: "https://wa.me/94112345678" };
    const palitha = { name: "Palitha", at: "10:42", phone: "+94771234567", phone_display: "077 123 4567", call: "tel:+94771234567", whatsapp: "https://wa.me/94771234567" };
    expect(callWho(palitha, office)).toEqual({ links: personLinks(palitha), office: false });
    expect(callWho({ name: "Nimal", at: "10:42" }, office)).toEqual({ links: office, office: true });
    expect(callWho({ name: "Nimal", at: "10:42" }, null)).toBeNull();
  });

  it("a decision carries the card's version", () => {
    expect(decisionInput({ id: "r1", version: 3, decision: "approve", driver: "kamal", defaultVehicle: "WP CAB-4521" })).toEqual({
      input: { request_id: "r1", decision: "approve", version: 3, driver: "kamal" },
    });
    expect(decisionInput({ id: "r1", decision: "decline", reason: "No van" })).toEqual({ input: { request_id: "r1", decision: "decline", reason: "No van" } });
    expect(decisionInput({ id: "r1", version: 3, decision: "approve", driver: "nuwan", vehicle: ON_THE_DAY, defaultVehicle: null })).toEqual({
      input: { request_id: "r1", decision: "approve", version: 3, vehicle: ON_THE_DAY, driver: "nuwan" },
    });
  });
});
