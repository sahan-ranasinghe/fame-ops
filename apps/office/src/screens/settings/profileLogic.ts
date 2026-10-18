// Phone numbers in the office (Hotfix 2, F): stored E.164 (+94…), shown
// "077 123 4567". My profile (update_my_profile: the server normalises 07…,
// 7…, 94…, +94… and refuses anything else in words), Settings → Users
// (update_office_user phone) and Settings → Fleet's office number
// (update_settings office_phone, sent as +94…). Pure.

/** The digits of a Sri Lankan number as +94 and nine digits; null for nothing typed; "bad" for anything else. */
export function phoneE164(text: string | null | undefined): string | null | "bad" {
  const t = (text ?? "").trim();
  if (!t) return null;
  if (/[^0-9+\s\-()]/.test(t)) return "bad";
  let d = t.replace(/[^0-9]/g, "");
  if (d.startsWith("0094")) d = d.slice(4);
  else if (d.startsWith("94") && d.length === 11) d = d.slice(2);
  else if (d.startsWith("0") && d.length === 10) d = d.slice(1);
  return /^[1-9]\d{8}$/.test(d) ? `+94${d}` : "bad";
}

export const PHONE_BAD = "Type a Sri Lankan number, e.g. 077 123 4567.";

/** The same number however it is written ("077 123 4567" and "+94771234567"); two blanks are the same too. */
export function samePhone(a: string | null | undefined, b: string | null | undefined): boolean {
  const x = phoneE164(a), y = phoneE164(b);
  if (x === "bad" || y === "bad") return (a ?? "").trim() === (b ?? "").trim();
  return x === y;
}

/**
 * update_my_profile's input from the field: the number as typed (the server normalises it and says what it refuses),
 * null to clear it; nothing when it is the number already saved.
 */
export function profileInput(text: string, saved: string | null | undefined): { nothing: true } | { input: { phone: string | null } } {
  if (samePhone(text, saved)) return { nothing: true };
  const t = text.trim();
  return { input: { phone: t ? t : null } };
}

/** update_settings for the office's number: +94… or null; an error for anything else. */
export function officePhoneValue(text: string): { error: string } | { value: string | null } {
  const v = phoneE164(text);
  return v === "bad" ? { error: PHONE_BAD } : { value: v };
}
