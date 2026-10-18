// Part 3b (G, docs/phase7-plan.md "Part 3b"): the driver's profile on the phone. Pure code with no phone modules, so
// scripts/test-asks.ts runs it as it is.
//   - Me shows the profile; app/profile-edit.tsx changes the phone, WhatsApp, the emergency contact and the licence (the
//     server is driver-api /profile: only the fields that changed are sent, null clears one, never the phone);
//   - the licence photos are photos rows of kind licence in <employee_id>/licence/ (set_my_licence_photo);
//   - a driver with no phone number is asked for it at app start (app/phone-prompt.tsx), no skip; with no connection the
//     screen lets the driver work and asks again at the next start.

import type { Employee } from './types';

/** The fields the driver changes (driver-api /profile takes exactly these; null clears one, never the phone). */
export interface ProfilePatch {
  phone?: string | null;
  whatsapp?: string | null;
  emergency_name?: string | null;
  emergency_relation?: string | null;
  emergency_phone?: string | null;
  licence_no?: string | null;
  licence_expiry?: string | null;
}

export type ProfileFields = Pick<
  Employee,
  'phone' | 'whatsapp' | 'emergency_name' | 'emergency_relation' | 'emergency_phone' | 'licence_no' | 'licence_expiry'
>;

/** What the form holds: the typed text of each field. */
export type ProfileForm = Record<keyof ProfilePatch, string>;

export const PROFILE_KEYS: (keyof ProfilePatch)[] = [
  'phone', 'whatsapp', 'emergency_name', 'emergency_relation', 'emergency_phone', 'licence_no', 'licence_expiry',
];
const PHONE_KEYS = new Set<keyof ProfilePatch>(['phone', 'whatsapp', 'emergency_phone']);

/**
 * A Sri Lankan number as the server stores it (+94…, the office's rule in _shared/fleet/format.ts phoneE164): "077 123
 * 4567", "771234567", "+94 77 123 4567" → "+94771234567"; anything else null.
 */
export function phoneE164(typed: string | null | undefined): string | null {
  if (!typed) return null;
  const d = typed.replace(/\D/g, '');
  if (/^0[1-9]\d{8}$/.test(d)) return `+94${d.slice(1)}`;
  if (/^[1-9]\d{8}$/.test(d)) return `+94${d}`;
  if (/^94[1-9]\d{8}$/.test(d)) return `+${d}`;
  return null;
}

/** "+94771234567" → "077 123 4567" (as Me and the office show it); anything else as it is. */
export function phoneLocal(stored: string | null | undefined): string {
  if (!stored) return '';
  const e = phoneE164(stored);
  if (!e) return stored;
  const local = `0${e.slice(3)}`;
  return `${local.slice(0, 3)} ${local.slice(3, 6)} ${local.slice(6)}`;
}

/** A real calendar date typed as YYYY-MM-DD. */
export function validDate(text: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text.trim());
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d && y >= 1900 && y <= 2100;
}

/** The form as it opens: the driver's values, the numbers as they read ("077 123 4567"). */
export function profileForm(me: Partial<ProfileFields> | null): ProfileForm {
  return {
    phone: phoneLocal(me?.phone),
    whatsapp: phoneLocal(me?.whatsapp),
    emergency_name: me?.emergency_name ?? '',
    emergency_relation: me?.emergency_relation ?? '',
    emergency_phone: phoneLocal(me?.emergency_phone),
    licence_no: me?.licence_no ?? '',
    licence_expiry: me?.licence_expiry ?? '',
  };
}

export type ProfileProblem = 'profile.badPhone' | 'profile.badDate';

/**
 * What to send: only the fields that changed (a number that reads the same as the stored one is unchanged; an emptied
 * field is null, which clears it; the phone cannot be emptied). A typed number that is not a Sri Lankan one, or a date
 * that is not YYYY-MM-DD, is a problem with the field named.
 */
export function profilePatch(
  me: Partial<ProfileFields> | null,
  form: ProfileForm,
): { patch: ProfilePatch; problem: { key: ProfileProblem; field: keyof ProfilePatch } | null } {
  const patch: ProfilePatch = {};
  for (const field of PROFILE_KEYS) {
    const typed = (form[field] ?? '').trim();
    const stored = me?.[field] ?? null;
    if (PHONE_KEYS.has(field)) {
      if (typed === '') {
        // The phone is never cleared (a driver always has one): an empty box is a missing number.
        if (field === 'phone') return { patch: {}, problem: { key: 'profile.badPhone', field } };
        if (stored !== null) patch[field] = null;
        continue;
      }
      const e164 = phoneE164(typed);
      if (!e164) return { patch: {}, problem: { key: 'profile.badPhone', field } };
      if (e164 !== (phoneE164(stored) ?? stored)) patch[field] = e164;
      continue;
    }
    if (field === 'licence_expiry' && typed !== '' && !validDate(typed)) {
      return { patch: {}, problem: { key: 'profile.badDate', field } };
    }
    const next = typed === '' ? null : typed;
    if (next !== (stored === '' ? null : stored)) patch[field] = next;
  }
  return { patch, problem: null };
}

/** Whether anything in the form differs from what is stored (the "Discard changes?" question). */
export function profileDirty(me: Partial<ProfileFields> | null, form: ProfileForm): boolean {
  const start = profileForm(me);
  return PROFILE_KEYS.some((field) => (form[field] ?? '').trim() !== start[field].trim());
}

// --- The phone prompt -------------------------------------------------------------------------------------------------

/**
 * Whether the phone prompt shows: the server said, in this run of the app, that the driver has no number (`fresh`, as
 * the photo step), never over a task in progress, and not after "Continue" with no connection in this run (it asks again
 * at the next start).
 */
export function needsPhonePrompt(
  me: Pick<Employee, 'phone'> | null,
  state: { fresh: boolean; taskRunning: boolean; deferred?: boolean },
): boolean {
  if (!me || !state.fresh || state.taskRunning || state.deferred) return false;
  return !me.phone || me.phone.trim() === '';
}

let promptDeferred = false;
/** "Continue" with no connection: the prompt stays away until the app starts again. */
export function deferPhonePrompt(): void {
  promptDeferred = true;
}
export function phonePromptDeferred(): boolean {
  return promptDeferred;
}

// --- The licence photos -----------------------------------------------------------------------------------------------

export type LicenceSide = 'front' | 'back';

/** A licence photo in the driver's own folder: <employee_id>/licence/<uuid>.jpg (set_my_licence_photo checks the folder). */
export function licencePhotoPath(employeeId: string, id: string): string {
  return `${employeeId}/licence/${id}.jpg`;
}

/** The photo id of a side on the employee row. */
export function licencePhotoId(me: Partial<Pick<Employee, 'licence_front_photo_id' | 'licence_back_photo_id'>> | null, side: LicenceSide): string | null {
  return (side === 'front' ? me?.licence_front_photo_id : me?.licence_back_photo_id) ?? null;
}

// --- This month on Me --------------------------------------------------------------------------------------------------

/** The driver's completed tasks this month and their km (a task with no km yet counts as a task, 0 km). */
export function monthTotals(rows: { km: number | null }[]): { tasks: number; km: number } {
  return { tasks: rows.length, km: Math.round(rows.reduce((sum, row) => sum + (row.km != null && row.km > 0 ? row.km : 0), 0)) };
}
