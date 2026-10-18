import { describe, expect, it } from "vitest";
import { emptyDriver, randomPin, validateNewDriver } from "./driverLogic";
import { docTone, emptyVehicle, vehicleInput } from "./vehicleLogic";

describe("Vehicle form", () => {
  it("needs a plate to register, and sends only what was filled in", () => {
    expect(vehicleInput(emptyVehicle(), null)).toEqual({ error: "Add the number plate." });
    const v = vehicleInput({ ...emptyVehicle(), reg: " WP CAB-4521 ", model: "Toyota HiAce", type: "van", seats: "14", rent: "180000", until: "2027-03-31", allow: "3000" }, null);
    expect(v).toEqual({ tool: "register_vehicle", input: { reg_no: "WP CAB-4521", make_model: "Toyota HiAce", vehicle_type: "van", seats: 14, monthly_rent_lkr: 180000, rent_until: "2027-03-31", monthly_km_allowance: 3000 } });
  });
  it("an update with nothing filled in is refused; booleans and dates go through as the tool expects", () => {
    expect(vehicleInput(emptyVehicle(), "WP CAB-4521")).toEqual({ error: "Nothing to change yet." });
    expect(vehicleInput({ ...emptyVehicle(), ingarage: "true", garage: "2026-10-14", active: "false", lic: "2027-01-01" }, "WP CAB-4521")).toEqual({
      tool: "update_vehicle", input: { reg_no: "WP CAB-4521", garage_booked_date: "2026-10-14", licence_expiry: "2027-01-01", in_garage: true, active: false },
    });
  });
  it("tones the document chips", () => {
    expect(docTone("red")).toBe("bad");
    expect(docTone("orange")).toBe("warn");
    expect(docTone("ok")).toBe("ok");
    expect(docTone(undefined)).toBe("unset");
  });
});

describe("New driver", () => {
  it("checks the username and the PIN", () => {
    expect(validateNewDriver(emptyDriver())).toEqual({ error: "Add the name, code and username." });
    expect(validateNewDriver({ ...emptyDriver(), name: "A", code: "E1", username: "a b", pin: "123456" })).toEqual({ error: "The username needs 3–40 letters, numbers, dots, dashes or underscores." });
    expect(validateNewDriver({ ...emptyDriver(), name: "A", code: "E1", username: "nuwan.p", pin: "12345" })).toEqual({ error: "The PIN must be exactly 6 digits." });
    // Part 3b (G): the mobile number is needed.
    expect(validateNewDriver({ ...emptyDriver(), name: "A", code: "E1", username: "nuwan.p", pin: "123456" })).toEqual({ error: "Add the driver's mobile number." });
    expect(validateNewDriver({ ...emptyDriver(), name: " Nuwan Perera ", code: "E0123", username: "nuwan.p", pin: "123456", phone: "0771234567" })).toEqual({
      input: { name: "Nuwan Perera", code: "E0123", username: "nuwan.p", pin: "123456", phone: "0771234567" },
    });
  });
  it("makes 6-digit PINs", () => {
    for (let i = 0; i < 20; i++) expect(randomPin()).toMatch(/^\d{6}$/);
  });
});
