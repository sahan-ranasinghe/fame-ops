// The vehicle form's rules: only filled-in fields are sent (an update keeps
// everything else), numbers are numbers, and the exact register_vehicle /
// update_vehicle arguments (the connector contract).

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
}

export const emptyVehicle = (): VehicleFields => ({
  reg: "", model: "", type: "", seats: "", allow: "", odo: "", rent: "", company: "", until: "", driver: "",
  svcint: "", svclast: "", svcdate: "", garage: "", lic: "", ins: "", emi: "", ingarage: "", active: "", custodian: "", custodianNote: "",
});

/** regNo null = register a new vehicle; otherwise update that plate. */
export function vehicleInput(f: VehicleFields, regNo: string | null): { error: string } | { input: Record<string, unknown>; tool: "register_vehicle" | "update_vehicle" } {
  const t = (s: string) => s.trim();
  const input: Record<string, unknown> = {};
  if (regNo === null) {
    if (!t(f.reg)) return { error: "Add the number plate." };
    input.reg_no = t(f.reg);
  } else {
    input.reg_no = regNo;
  }
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
