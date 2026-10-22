// Round 4–7, feature 5 (Sahan, 22 October 2026): a vehicle's fuel type and grade, and the fuel card's words. The estimate
// itself is the database's (fuel_estimate, migration 20261022120300_round5_fuel_card): one rule for the phone and the office.

export const FUEL_TYPES = ["petrol", "diesel", "hybrid", "electric"] as const;
export type FuelType = (typeof FUEL_TYPES)[number];
export const FUEL_GRADES = ["petrol_92", "petrol_95", "auto_diesel", "super_diesel"] as const;
export type FuelGrade = (typeof FUEL_GRADES)[number];

export const FUEL_TYPE_TEXT: Record<FuelType, string> = {
  petrol: "Petrol",
  diesel: "Diesel",
  hybrid: "Hybrid (petrol)",
  electric: "Electric",
};
export const FUEL_GRADE_TEXT: Record<FuelGrade, string> = {
  petrol_92: "Petrol 92",
  petrol_95: "Petrol 95",
  auto_diesel: "Auto Diesel",
  super_diesel: "Super Diesel",
};

/** The grades a fuel type takes (petrol and a hybrid a petrol grade, diesel a diesel one, electric none). Pure. */
export function gradesFor(type: FuelType | null | undefined): readonly FuelGrade[] {
  if (type === "petrol" || type === "hybrid") return ["petrol_92", "petrol_95"];
  if (type === "diesel") return ["auto_diesel", "super_diesel"];
  return [];
}

/** "Petrol 92", "Diesel", "Hybrid (petrol) · Petrol 95", "Fuel type: not set". Pure. */
export function fuelText(type: string | null | undefined, grade?: string | null): string {
  if (!type) return "Fuel type: not set";
  const t = FUEL_TYPE_TEXT[type as FuelType] ?? type;
  const g = grade ? FUEL_GRADE_TEXT[grade as FuelGrade] : undefined;
  if (!g) return t;
  return type === "petrol" || type === "diesel" ? g : `${t} · ${g}`;
}

/** A grade that does not fit the type, in words, or null. Pure. */
export function gradeProblem(type: string | null | undefined, grade: string | null | undefined): string | null {
  if (!grade) return null;
  if (!type) return "fuel_grade needs a fuel_type.";
  if (!gradesFor(type as FuelType).includes(grade as FuelGrade)) {
    const fits = gradesFor(type as FuelType);
    return `${FUEL_GRADE_TEXT[grade as FuelGrade] ?? grade} does not fit ${FUEL_TYPE_TEXT[type as FuelType] ?? type}` +
      (fits.length ? ` (${fits.map((x) => FUEL_GRADE_TEXT[x]).join(" or ")}).` : " (no grade).");
  }
  return null;
}

/** What a fill of this vehicle is: a hybrid fills petrol; electric none. Pure. */
export function fillTypeOf(type: string | null | undefined): "petrol" | "diesel" | null {
  if (type === "petrol" || type === "hybrid") return "petrol";
  if (type === "diesel") return "diesel";
  return null;
}

export interface FuelEstimate {
  task_id: string;
  km?: number;
  fuel_type?: FuelType;
  fuel_grade?: FuelGrade;
  electric: boolean;
  km_per_l?: number;
  source?: "history" | "default";
  litres_low?: number;
  litres_high?: number;
  answer?: "enough" | "fill_on_way";
  answered_at?: string;
}

export const FUEL_ANSWER_TEXT = { enough: "Enough fuel", fill_on_way: "Fills up on the way" } as const;

/** "About 180 km · roughly 13–17 L diesel (approx.)"; electric: "About 180 km · check the battery". Pure. */
export function estimateText(e: Pick<FuelEstimate, "km" | "electric" | "litres_low" | "litres_high" | "fuel_type">): string | null {
  if (e.km == null) return null;
  if (e.electric) return `About ${e.km} km · check the battery`;
  const fuel = e.fuel_type ? (e.fuel_type === "hybrid" ? "petrol" : FUEL_TYPE_TEXT[e.fuel_type].toLowerCase()) : "fuel";
  const litres = e.litres_low === e.litres_high ? `${e.litres_low}` : `${e.litres_low}–${e.litres_high}`;
  return `About ${e.km} km · roughly ${litres} L ${fuel} (approx.)`;
}
