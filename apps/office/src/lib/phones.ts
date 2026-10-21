// Sri Lankan phone numbers as the office types them (Hotfix 2, F): stored E.164 (+94…), shown "077 123 4567". The same
// file in Office mode (apps/driver/src/office/trip/phones.ts): the request and task rules on both sides check a number
// alike (scripts/test-shared-logic.ts and src/sharedLogic.test.ts fail when the two differ). Pure.

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
