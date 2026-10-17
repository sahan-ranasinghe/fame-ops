// A vehicle's documents (Phase 7, §28): the kinds, their names, which ones carry an expiry date and which ones an active
// vehicle should have. Pure: the document tools, list_vehicles and the issues read the same rules.

export const DOC_KINDS = ["revenue_licence", "insurance", "emission", "registration", "lease", "other"] as const;
export type DocKind = typeof DOC_KINDS[number];

export const DOC_NAME: Record<DocKind, string> = {
  revenue_licence: "Revenue licence",
  insurance: "Insurance",
  emission: "Emission test",
  registration: "Registration (CR)",
  lease: "Rent or lease agreement",
  other: "Other",
};

/** The kinds that carry an expiry date (written to the vehicle's own date, both ways). */
export const DOC_EXPIRES: readonly DocKind[] = ["revenue_licence", "insurance", "emission", "lease"];

/** What an active vehicle should have (§28): the four papers, and the agreement when it is rented. */
export function requiredKinds(v: { rental_company_id: string | null }): DocKind[] {
  return ["revenue_licence", "insurance", "emission", "registration", ...(v.rental_company_id ? ["lease" as const] : [])];
}

/** The kinds missing from what an active vehicle should have, in words: "insurance, emission test, CR". */
export function missingText(kinds: readonly DocKind[]): string {
  const word: Record<DocKind, string> = {
    revenue_licence: "revenue licence",
    insurance: "insurance",
    emission: "emission test",
    registration: "CR",
    lease: "rent or lease agreement",
    other: "other",
  };
  return kinds.map((k) => word[k]).join(", ");
}
