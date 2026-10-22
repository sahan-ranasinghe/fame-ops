// The vehicle form's rules: only filled-in fields are sent (an update keeps
// everything else), numbers are numbers, and the exact register_vehicle /
// update_vehicle arguments (the connector contract).
// Round 4–7, feature 5 (phase8-plan.md §33.2): the fuel type is required on register and on edit (an edit keeps the
// vehicle's own when one is set), the grade optional and only one that fits the type (Petrol 92 / 95 for petrol and a
// hybrid, Auto / Super Diesel for diesel, none for electric); the server's fuelCard.ts has the same lists.
import type { FuelGrade, FuelType, VehicleCard } from "../data/types";

/** The fuel types in the site's words (the server's FUEL_TYPE_TEXT). */
export const FUEL_TYPES: readonly (readonly [FuelType, string])[] = [
  ["petrol", "Petrol"],
  ["diesel", "Diesel"],
  ["hybrid", "Hybrid (petrol)"],
  ["electric", "Electric"],
];

/** The grades in the site's words (the server's FUEL_GRADE_TEXT). */
export const FUEL_GRADE_TEXT: Record<FuelGrade, string> = {
  petrol_92: "Petrol 92",
  petrol_95: "Petrol 95",
  auto_diesel: "Auto Diesel",
  super_diesel: "Super Diesel",
};

/** The grades a fuel type takes: petrol and a hybrid a petrol grade, diesel a diesel one, electric (or none) none. */
export function gradesFor(type: FuelType | "" | null | undefined): FuelGrade[] {
  if (type === "petrol" || type === "hybrid") return ["petrol_92", "petrol_95"];
  if (type === "diesel") return ["auto_diesel", "super_diesel"];
  return [];
}

/** What the vehicle has now (the edit form keeps it unless something else is picked). */
export type FuelNow = Pick<VehicleCard, "fuel_type" | "fuel_grade">;

export interface VehicleFields {
  reg: string;
  model: string;
  type: string;
  seats: string;
  allow: string;
  odo: string;
  rent: string;
  company: string;
  until: string;
  driver: string;
  svcint: string;
  svclast: string;
  svcdate: string;
  garage: string;
  lic: string;
  ins: string;
  emi: string;
  ingarage: "" | "true" | "false";
  active: "" | "true" | "false";
  /** The custodian: an office person's name or e-mail; "none" clears it. */
  custodian: string;
  custodianNote: string;
  /** Round 4–7 (5): "" = not picked (register) or the vehicle's own (edit). Absent in a draft from before. */
  fuelType?: FuelType | "";
  /** "" = none picked (register) or the vehicle's own (edit); "none" = no grade. */
  fuelGrade?: FuelGrade | "" | "none";
}

export const emptyVehicle = (): VehicleFields => ({
  reg: "", model: "", type: "", seats: "", allow: "", odo: "", rent: "", company: "", until: "", driver: "",
  svcint: "", svclast: "", svcdate: "", garage: "", lic: "", ins: "", emi: "", ingarage: "", active: "", custodian: "", custodianNote: "",
  fuelType: "", fuelGrade: "",
});

/** The fuel type and grade the form shows: what was picked, else the vehicle's own; a grade that does not fit the type is none. */
export function fuelShown(f: Pick<VehicleFields, "fuelType" | "fuelGrade">, now?: FuelNow | null): { type: FuelType | null; grade: FuelGrade | null } {
  const type = f.fuelType || now?.fuel_type || null;
  const picked = f.fuelGrade === "none" ? null : f.fuelGrade || now?.fuel_grade || null;
  const grade = picked && gradesFor(type).includes(picked) ? picked : null;
  return { type, grade };
}

/** A fuel type picked: a grade that no longer fits it goes ("none" on an edit, so the vehicle's own is not kept either). */
export function withFuelType(f: Pick<VehicleFields, "fuelType" | "fuelGrade">, type: FuelType, now?: FuelNow | null): Pick<VehicleFields, "fuelType" | "fuelGrade"> {
  const was = fuelShown(f, now).grade;
  return { fuelType: type, fuelGrade: was && gradesFor(type).includes(was) ? f.fuelGrade ?? "" : now?.fuel_grade ? "none" : "" };
}

/** A grade picked, or the picked one tapped again (no grade). */
export function withFuelGrade(f: Pick<VehicleFields, "fuelType" | "fuelGrade">, grade: FuelGrade | "", now?: FuelNow | null): Pick<VehicleFields, "fuelGrade"> {
  if (!grade || fuelShown(f, now).grade === grade) return { fuelGrade: now?.fuel_grade ? "none" : "" };
  return { fuelGrade: grade };
}

/**
 * Why the form cannot be saved yet, for the line under the button: the fuel type (register: always; an edit: once the
 * vehicle is known and it has none). Null = it can.
 */
export function fuelReason(f: Pick<VehicleFields, "fuelType" | "fuelGrade">, isNew: boolean, now?: FuelNow | null): string | null {
  if (!isNew && now === undefined) return null;
  return fuelShown(f, now).type ? null : "Pick the fuel type";
}

/** The vehicle's fuel as its page and the list say it ("Petrol 92", "Diesel"), or "Fuel type: not set" (amber). */
export function fuelLine(v: Pick<VehicleCard, "fuel_type" | "fuel_text">): { text: string; notSet: boolean } | null {
  if (v.fuel_type) return { text: v.fuel_text ?? FUEL_TYPES.find(([k]) => k === v.fuel_type)?.[1] ?? v.fuel_type, notSet: false };
  // An older answer (no fuel_text at all) says nothing.
  return v.fuel_text ? { text: v.fuel_text, notSet: true } : null;
}

/**
 * regNo null = register a new vehicle; otherwise update that plate. `now`: the vehicle's fuel as it is (an edit; undefined
 * = not known yet: only a picked type or grade is sent). The fuel type is required (register_vehicle takes it; an edit sends
 * it and the grade only when they differ from the vehicle's).
 */
export function vehicleInput(f: VehicleFields, regNo: string | null, now?: FuelNow | null): { error: string } | { input: Record<string, unknown>; tool: "register_vehicle" | "update_vehicle" } {
  const t = (s: string) => s.trim();
  const input: Record<string, unknown> = {};
  if (regNo === null) {
    if (!t(f.reg)) return { error: "Add the number plate." };
    input.reg_no = t(f.reg);
  } else {
    input.reg_no = regNo;
  }
  const fuel = fuelShown(f, now);
  const fuelWhy = fuelReason(f, regNo === null, now);
  if (fuelWhy) return { error: `${fuelWhy}.` };
  const intv = (k: string, v: string) => { if (t(v) !== "") input[k] = parseInt(t(v), 10); };
  if (t(f.model)) input.make_model = t(f.model);
  if (t(f.type)) input.vehicle_type = t(f.type);
  intv("seats", f.seats);
  intv("monthly_km_allowance", f.allow);
  intv("current_odometer_km", f.odo);
  if (t(f.rent) !== "") input.monthly_rent_lkr = Number(t(f.rent));
  if (t(f.company)) input.rental_company = t(f.company);
  if (t(f.until)) input.rent_until = t(f.until);
  if (t(f.driver)) input.regular_driver = t(f.driver);
  intv("service_interval_km", f.svcint);
  intv("last_service_odometer_km", f.svclast);
  if (t(f.svcdate)) input.next_service_date = t(f.svcdate);
  if (t(f.garage)) input.garage_booked_date = t(f.garage);
  if (t(f.lic)) input.licence_expiry = t(f.lic);
  if (t(f.ins)) input.insurance_expiry = t(f.ins);
  if (t(f.emi)) input.emission_expiry = t(f.emi);
  if (f.ingarage) input.in_garage = f.ingarage === "true";
  if (f.active) input.active = f.active === "true";
  if (t(f.custodian)) input.custodian = t(f.custodian).toLowerCase() === "none" ? null : t(f.custodian);
  if (t(f.custodianNote)) input.custodian_note = t(f.custodianNote).toLowerCase() === "none" ? null : t(f.custodianNote);
  if (regNo === null) {
    input.fuel_type = fuel.type;
    if (fuel.grade) input.fuel_grade = fuel.grade;
  } else if (now === undefined) {
    // The vehicle not known yet: only what was picked.
    if (f.fuelType) input.fuel_type = f.fuelType;
    if (f.fuelGrade) input.fuel_grade = f.fuelGrade === "none" ? null : f.fuelGrade;
  } else {
    if (fuel.type && fuel.type !== (now?.fuel_type ?? null)) input.fuel_type = fuel.type;
    if (fuel.grade !== (now?.fuel_grade ?? null)) input.fuel_grade = fuel.grade;
  }
  if (regNo !== null && Object.keys(input).length === 1) return { error: "Nothing to change yet." };
  return { input, tool: regNo === null ? "register_vehicle" : "update_vehicle" };
}

/** Lic / Ins / Emi chip tone from the tool's chip word. */
export function docTone(chip?: string): "bad" | "warn" | "ok" | "unset" {
  const c = String(chip || "not set").toLowerCase();
  if (c === "red" || c.includes("expired")) return "bad";
  if (c === "orange" || c.includes("soon")) return "warn";
  if (c === "not set") return "unset";
  return "ok";
}
