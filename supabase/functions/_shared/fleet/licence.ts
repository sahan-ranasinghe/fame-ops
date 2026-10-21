// A person's driving licence as the approver sees it for a self-driven trip (Round 3, Part A 5: Zipcar for Business /
// Enterprise CarShare check that the member's licence is on file). Never a block: a warning beside the approval.

export type LicenceState = "on_file" | "none" | "expired";

export interface LicenceFields {
  licence_no: string | null;
  licence_expiry: string | null;
  licence_front_photo_id: string | null;
  licence_back_photo_id: string | null;
}

/** on_file = a number or a photo, not expired on `day` (YYYY-MM-DD); expired = its expiry is before that day; none = nothing. */
export function licenceState(e: Partial<LicenceFields> | undefined, day: string): LicenceState {
  if (!e) return "none";
  if (e.licence_expiry && e.licence_expiry < day) return "expired";
  return e.licence_no || e.licence_front_photo_id || e.licence_back_photo_id ? "on_file" : "none";
}

/**
 * The warning for a self-driven trip with no licence on file (an expired one is already warned by the assign check,
 * "X's driving licence expired on …"). Null when there is a licence on file or it is not a self-driven trip.
 */
export function noLicenceWarning(name: string, e: Partial<LicenceFields> | undefined, day: string): string | null {
  return licenceState(e, day) === "none" ? `${name} has no driving licence on file (self-drive).` : null;
}
