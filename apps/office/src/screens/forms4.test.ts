import { describe, expect, it } from "vitest";
import { emptyDriver, randomPin, validateNewDriver } from "./driverLogic";
import { docTone, emptyVehicle, fuelLine, fuelReason, fuelShown, gradesFor, vehicleInput, withFuelGrade, withFuelType } from "./vehicleLogic";

describe("Vehicle form", () => {
  it("needs a plate to register, and sends only what was filled in", () => {
    expect(vehicleInput(emptyVehicle(), null)).toEqual({ error: "Add the number plate." });
    const v = vehicleInput({ ...emptyVehicle(), reg: " WP CAB-4521 ", model: "Toyota HiAce", type: "van", seats: "14", rent: "180000", until: "2027-03-31", allow: "3000", fuelType: "diesel" }, null);
    expect(v).toEqual({ tool: "register_vehicle", input: { reg_no: "WP CAB-4521", make_model: "Toyota HiAce", vehicle_type: "van", seats: 14, monthly_rent_lkr: 180000, rent_until: "2027-03-31", monthly_km_allowance: 3000, fuel_type: "diesel" } });
  });
  // Round 4–7, feature 5: the fuel type is required on register and on edit; the grade optional and only one that fits.
  it("needs the fuel type to register; the grade only when it fits the type", () => {
    const f = { ...emptyVehicle(), reg: "WP CAB-4521" };
    expect(vehicleInput(f, null)).toEqual({ error: "Pick the fuel type." });
    expect(fuelReason(f, true, null)).toBe("Pick the fuel type");
    expect(vehicleInput({ ...f, fuelType: "petrol", fuelGrade: "petrol_95" }, null)).toEqual({ tool: "register_vehicle", input: { reg_no: "WP CAB-4521", fuel_type: "petrol", fuel_grade: "petrol_95" } });
    expect(vehicleInput({ ...f, fuelType: "electric", fuelGrade: "petrol_95" }, null)).toEqual({ tool: "register_vehicle", input: { reg_no: "WP CAB-4521", fuel_type: "electric" } });
    expect(gradesFor("hybrid")).toEqual(["petrol_92", "petrol_95"]);
    expect(gradesFor("diesel")).toEqual(["auto_diesel", "super_diesel"]);
    expect(gradesFor("electric")).toEqual([]);
  });
  it("an edit starts from the vehicle's own fuel, sends only what changed, and waits for a type when the vehicle has none", () => {
    const now = { fuel_type: "petrol" as const, fuel_grade: "petrol_92" as const };
    const f = emptyVehicle();
    expect(fuelShown(f, now)).toEqual({ type: "petrol", grade: "petrol_92" });
    expect(vehicleInput({ ...f, seats: "9" }, "WP CAB-4521", now)).toEqual({ tool: "update_vehicle", input: { reg_no: "WP CAB-4521", seats: 9 } });
    // A new type drops a grade that no longer fits; a grade that still fits stays.
    const diesel = { ...f, ...withFuelType(f, "diesel", now) };
    expect(fuelShown(diesel, now)).toEqual({ type: "diesel", grade: null });
    expect(vehicleInput(diesel, "WP CAB-4521", now)).toEqual({ tool: "update_vehicle", input: { reg_no: "WP CAB-4521", fuel_type: "diesel", fuel_grade: null } });
    expect(fuelShown({ ...f, ...withFuelType(f, "hybrid", now) }, now).grade).toBe("petrol_92");
    // Not set (or the picked grade again) clears it.
    expect(vehicleInput({ ...f, ...withFuelGrade(f, "", now) }, "WP CAB-4521", now)).toEqual({ tool: "update_vehicle", input: { reg_no: "WP CAB-4521", fuel_grade: null } });
    // A vehicle with no fuel type: the edit waits for one (not while it loads).
    expect(fuelReason(f, false, { fuel_type: undefined })).toBe("Pick the fuel type");
    expect(vehicleInput({ ...f, seats: "9" }, "WP CAB-4521", { fuel_type: undefined })).toEqual({ error: "Pick the fuel type." });
    expect(fuelReason(f, false, undefined)).toBeNull();
  });
  it("says the vehicle's fuel, or Fuel type: not set", () => {
    expect(fuelLine({ fuel_type: "petrol", fuel_text: "Petrol 92" })).toEqual({ text: "Petrol 92", notSet: false });
    expect(fuelLine({ fuel_text: "Fuel type: not set" })).toEqual({ text: "Fuel type: not set", notSet: true });
    expect(fuelLine({})).toBeNull();
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
