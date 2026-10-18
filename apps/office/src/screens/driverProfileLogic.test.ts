// Part 3b (G): the profile's fields, update_driver's patch of what changed, the change log and what is missing.
import { describe, expect, it } from "vitest";
import { FULL_PROFILE, LIMITED_PROFILE } from "./__fixtures__/driverProfile";
import { changeText, missingText, monthText, profileFields, profilePatch, SECTION_FIELDS, seesPrivate, updateDriverArgs } from "./driverProfileLogic";

describe("the profile's fields", () => {
  it("from driver_profile: the numbers as shown, the emergency contact, the licence", () => {
    expect(profileFields(FULL_PROFILE)).toEqual({
      phone: "077 111 2222",
      whatsapp: "077 999 8888",
      emergency_name: "Nimali Perera",
      emergency_relation: "wife",
      emergency_phone: "071 222 3333",
      licence_no: "B1234567",
      licence_expiry: "2026-11-10",
    });
  });

  it("without the private part: the licence expiry from the driver's chip; without the profile: the list row's", () => {
    expect(profileFields(LIMITED_PROFILE)).toMatchObject({ emergency_name: "", licence_no: "", licence_expiry: "2026-11-10" });
    expect(profileFields(undefined, { phone: "077 111 2222", licence: { expiry: "2027-01-31" } })).toEqual({
      phone: "077 111 2222", whatsapp: "", emergency_name: "", emergency_relation: "", emergency_phone: "", licence_no: "", licence_expiry: "2027-01-31",
    });
    expect(seesPrivate(FULL_PROFILE)).toBe(true);
    expect(seesPrivate(LIMITED_PROFILE)).toBe(false);
    expect(seesPrivate(undefined)).toBe(false);
  });
});

describe("update_driver's patch: only what changed", () => {
  const before = profileFields(FULL_PROFILE);

  it("nothing changed: an empty patch; spaces around a value are not a change", () => {
    expect(profilePatch(before, { ...before, phone: " 077 111 2222 " })).toEqual({ patch: {} });
  });

  it("a changed field sends its new text, an emptied one null", () => {
    expect(profilePatch(before, { ...before, whatsapp: "", emergency_relation: "sister", licence_no: " B7654321 " })).toEqual({
      patch: { whatsapp: null, emergency_relation: "sister", licence_no: "B7654321" },
    });
    expect(updateDriverArgs("kamal.p", { whatsapp: null })).toEqual({ username: "kamal.p", whatsapp: null });
  });

  it("only the section's fields: a change elsewhere in the form is not sent", () => {
    const after = { ...before, phone: "077 555 6666", emergency_name: "Someone else" };
    expect(profilePatch(before, after, SECTION_FIELDS.contact)).toEqual({ patch: { phone: "077 555 6666" } });
    expect(profilePatch(before, after, SECTION_FIELDS.emergency)).toEqual({ patch: { emergency_name: "Someone else" } });
  });

  it("the phone cannot be emptied; the licence expiry must be a date (emptied = null)", () => {
    expect(profilePatch(before, { ...before, phone: "  " })).toEqual({ error: "A driver always has a mobile number: type the new one instead of emptying it." });
    expect(profilePatch(before, { ...before, licence_expiry: "next year" })).toEqual({ error: "The licence expiry is a date." });
    expect(profilePatch(before, { ...before, licence_expiry: "" })).toEqual({ patch: { licence_expiry: null } });
  });
});

describe("the change log and what is missing, in words", () => {
  it("each change: what, from → to", () => {
    expect(changeText(FULL_PROFILE.changes![0])).toBe("Phone: 077 000 0000 → 077 111 2222");
    expect(changeText(FULL_PROFILE.changes![1])).toBe("Licence (front): a new photo");
    expect(changeText({ what: "WhatsApp", from: "077 999 8888" })).toBe("WhatsApp: 077 999 8888 → cleared");
  });

  it("missing, this month", () => {
    expect(missingText(["phone", "licence expiry", "emergency contact"])).toBe("Missing: phone, licence expiry and emergency contact.");
    expect(missingText(["phone"])).toBe("Missing: phone.");
    expect(missingText([])).toBeNull();
    expect(monthText(FULL_PROFILE.this_month)).toBe("12 tasks · 840 km");
    expect(monthText({ month: "2026-10", tasks: 1, km: 1200 })).toBe("1 task · 1,200 km");
  });
});
