// Part 3b (G): the driver's profile on the manage page, the pure part: the editable fields from driver_profile (or, without
// it, from the driver list's row), the sections they belong to, update_driver's patch with only what changed (an emptied
// field sends null; the phone cannot be emptied), the change log's lines and what is missing, in words. Pure.
import type { Driver, DriverProfile } from "../data/types";

export interface ProfileFields {
  phone: string;
  whatsapp: string;
  emergency_name: string;
  emergency_relation: string;
  emergency_phone: string;
  licence_no: string;
  /** YYYY-MM-DD or "". */
  licence_expiry: string;
}

export type ProfileSection = "contact" | "emergency" | "licence";

/** The fields each section edits (the private ones only reach people with users or vehicles). */
export const SECTION_FIELDS: Record<ProfileSection, (keyof ProfileFields)[]> = {
  contact: ["phone", "whatsapp"],
  emergency: ["emergency_name", "emergency_relation", "emergency_phone"],
  licence: ["licence_no", "licence_expiry"],
};

export const FIELD_LABEL: Record<keyof ProfileFields, string> = {
  phone: "Mobile",
  whatsapp: "WhatsApp",
  emergency_name: "Name",
  emergency_relation: "Relationship",
  emergency_phone: "Phone",
  licence_no: "Licence number",
  licence_expiry: "Expires",
};

/** The profile answer carries the private part (the emergency contact, the licence, the changes) for this person. */
export const seesPrivate = (p: DriverProfile | undefined): boolean => !!p && p.licence !== undefined && !p.private_hidden;

/** The fields as the form starts them: the profile's (the numbers as shown, "077 123 4567"), else the list row's. */
export function profileFields(p: DriverProfile | undefined, row?: Pick<Driver, "phone" | "licence"> | null): ProfileFields {
  if (!p) {
    return {
      phone: row?.phone ?? "",
      whatsapp: "",
      emergency_name: "",
      emergency_relation: "",
      emergency_phone: "",
      licence_no: "",
      licence_expiry: row?.licence?.expiry ?? "",
    };
  }
  return {
    phone: p.driver.phone_display ?? p.driver.phone ?? "",
    whatsapp: p.driver.whatsapp_display ?? p.driver.whatsapp ?? "",
    emergency_name: p.emergency?.name ?? "",
    emergency_relation: p.emergency?.relation ?? "",
    emergency_phone: p.emergency?.phone_display ?? p.emergency?.phone ?? "",
    licence_no: p.licence?.number ?? "",
    licence_expiry: p.licence?.expiry ?? p.driver.licence_chip?.expiry ?? "",
  };
}

export type ProfilePatch = Partial<Record<keyof ProfileFields, string | null>>;

/**
 * update_driver's fields with only what changed among `keys` (all by default): a changed field sends its new text
 * (trimmed), an emptied one null. The phone cannot be emptied (a driver always has a mobile number); a licence expiry must
 * be a date. Nothing changed = an empty patch.
 */
export function profilePatch(before: ProfileFields, after: ProfileFields, keys: (keyof ProfileFields)[] = Object.keys(before) as (keyof ProfileFields)[]): { patch: ProfilePatch } | { error: string } {
  const patch: ProfilePatch = {};
  for (const k of keys) {
    const was = before[k].trim();
    const now = after[k].trim();
    if (now === was) continue;
    if (k === "phone" && !now) return { error: "A driver always has a mobile number: type the new one instead of emptying it." };
    if (k === "licence_expiry" && now && !/^\d{4}-\d{2}-\d{2}$/.test(now)) return { error: "The licence expiry is a date." };
    patch[k] = now || null;
  }
  return { patch };
}

/** update_driver's arguments for a patch. */
export const updateDriverArgs = (username: string, patch: ProfilePatch): Record<string, unknown> => ({ username, ...patch });

/** "Phone: 077 111 2222 → 077 333 4444", "Licence (front): a new photo", "WhatsApp: set to 077 …", "Licence number: cleared". */
export function changeText(c: { what: string; from?: string; to?: string }): string {
  if (c.from && c.to) return `${c.what}: ${c.from} → ${c.to}`;
  if (c.to) return `${c.what}: ${c.to}`;
  if (c.from) return `${c.what}: ${c.from} → cleared`;
  return c.what;
}

/** "Missing: phone, licence expiry and emergency contact." or null. */
export function missingText(missing: string[] | undefined): string | null {
  if (!missing?.length) return null;
  const list = missing.length === 1 ? missing[0] : `${missing.slice(0, -1).join(", ")} and ${missing[missing.length - 1]}`;
  return `Missing: ${list}.`;
}

/** "12 tasks · 840 km" for This month. */
export function monthText(m: DriverProfile["this_month"] | undefined): string {
  if (!m) return "—";
  return `${m.tasks} task${m.tasks === 1 ? "" : "s"} · ${Math.round(m.km).toLocaleString("en-US")} km`;
}
