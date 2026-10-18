// No vehicle up front (Hotfix 2, J). With the fleet setting vehicle_on_the_day
// on, a task's vehicle may be a plate, "on the day" (the vehicle the driver
// holds that day, confirmed at Start task) or "any van" (any vehicle of a
// type, picked by the driver at Start task): exactly the words create_task,
// plan_task, update_task, decide_request, redecide_request and book_vehicle
// take as `vehicle`. The default when nothing is picked: the driver's vehicle
// on the day for a later day, and for today when the driver brings none (no
// vehicle today and no regular one); otherwise, as before, the driver's
// vehicle today, else their regular one. Saving never waits for a vehicle.
// With the setting off the forms are as they were. Pure.
import type { DefaultVehicle } from "./availabilityLogic";

/** The vehicle the driver holds on the day. */
export const ON_THE_DAY = "on the day";
export const ON_THE_DAY_LABEL = "Driver's vehicle on the day";

/** The types a task may ask for ("any van"), as the vehicles are registered. */
export const ANY_TYPES: [type: string, label: string][] = [
  ["car", "Any car"],
  ["van", "Any van"],
  ["double_cab", "Any double cab"],
  ["lorry", "Any lorry"],
];

/** "van" → "any van", "double_cab" → "any double cab". */
export const anyValue = (type: string) => `any ${type.replace(/_/g, " ")}`;

/** A choice word ("on the day", "any van") rather than a plate. */
export const isChoice = (v: string | null | undefined): boolean => !!v && (v === ON_THE_DAY || /^any /.test(v));

/** The words for a vehicle value: "Driver's vehicle on the day", "Any van", else the plate as it is. */
export function choiceLabel(v: string): string {
  if (v === ON_THE_DAY) return ON_THE_DAY_LABEL;
  const t = ANY_TYPES.find(([k]) => anyValue(k) === v);
  return t ? t[1] : v;
}

/** The vehicle a form takes when none is picked: a plate the driver brings, the driver's vehicle on the day, or none known. */
export type VehicleDefault =
  | { kind: "plate"; reg_no: string; why: string }
  | { kind: "on_the_day"; why: string }
  | null;

/**
 * The default. `on`: the fleet setting vehicle_on_the_day. `def`: the vehicle the driver brings today (their vehicle
 * today, else their regular one); null = known to bring none; undefined = not known yet (Who's available still loading:
 * no default yet, so it does not show the day and then jump to a plate). A later `date` than `today` (both YYYY-MM-DD)
 * leaves it to the day; so does today with a driver known to bring none.
 */
export function vehicleDefault(o: { on: boolean; date: string; today: string; driver: string; def: DefaultVehicle | null | undefined }): VehicleDefault {
  if (o.on && /^\d{4}-\d{2}-\d{2}$/.test(o.date) && o.date > o.today) return { kind: "on_the_day", why: "a later day: the vehicle the driver holds then" };
  if (o.def) return { kind: "plate", reg_no: o.def.reg_no, why: o.def.why };
  if (o.on && o.driver && o.def === null) return { kind: "on_the_day", why: "the driver holds no vehicle today and has no regular one" };
  return null;
}

/** The driver's vehicle as the default takes it: known, known to be none (null), or not known yet (undefined). */
export const knownDef = (def: DefaultVehicle | null, known: boolean): DefaultVehicle | null | undefined => def ?? (known ? null : undefined);

/**
 * The vehicle the call names: the one picked, else "on the day" when that is the default; "" leaves it to the server
 * (it takes the driver's vehicle today, else their regular one, the same the form shows).
 */
export function vehicleArg(picked: string, d: VehicleDefault): string {
  if (picked.trim()) return picked.trim();
  return d?.kind === "on_the_day" ? ON_THE_DAY : "";
}

/** The value the form shows as chosen: the one picked, else the default's (a plate, or "on the day"). */
export function shownVehicle(picked: string, d: VehicleDefault): string {
  if (picked) return picked;
  return d?.kind === "plate" ? d.reg_no : d?.kind === "on_the_day" ? ON_THE_DAY : "";
}

/** The vehicle in words where no plate is set yet: the answer's vehicle_text ("Vehicle: on the day", "Any van"). */
export function vehicleWords(v: { vehicle?: string | null; vehicle_text?: string | null }): string {
  return v.vehicle || v.vehicle_text || "";
}
