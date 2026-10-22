// Office mode (Phase 8, O2, item 7): People and Quick settings under More (designs 19 and 20), the pure rules, no phone
// (scripts/test-people.ts runs them in node): the two lists' inputs and pages, the rows' lines, a new driver (the site's
// driverLogic), a driver's profile editor with only what changed (driverProfileLogic), the office users' rules (usersLogic:
// view locked while another permission needs it, the presets, a person never dropping their own users permission), the
// phone rule (+94…, profileLogic), and the quick settings rows with each value's update_settings input. Problems are short
// codes the screens turn into words (office.people.err.*), never English here.

import type { FilterDef, FilterValues } from '../lib/patterns/filterLogic';

import { IMPLIES_VIEW, normalisePermissions, type Permission, PERMISSION_TEXT, PERMISSIONS, PRESETS } from './permissions';
import type { Driver, DriverProfile, DriversList, FleetSettings, OfficeUser, OfficeUsers } from './types';

export type Words = (key: string, vars?: Record<string, string | number>) => string;
export type Tone = 'blue' | 'green' | 'amber' | 'red' | 'muted';

/** A page of the lists (the server's limit + cursor). */
export const LIMIT = 25;
/** The words typed go to the server this long after the last key. */
export const SEARCH_DEBOUNCE_MS = 500;

// ---- The lists ----

/** list_drivers' input: the search trimmed, switched-off drivers when asked, a page at a time. */
/** People → Drivers' Filter sheet: Active (the default) or With switched off (list_drivers' `include_inactive`). */
export function peopleDriverDefs(tr: Words): FilterDef[] {
  return [{
    key: 'show',
    label: tr('office.people.filterShow'),
    kind: 'single',
    default: 'active',
    options: [{ value: 'active', label: tr('office.people.filterActive') }, { value: 'all', label: tr('office.people.filterAll') }],
  }];
}

/** Whether the switched-off drivers are asked for too. */
export const includeInactiveOf = (values: FilterValues): boolean => values.show === 'all';

export function driversArgs(search: string, includeInactive: boolean, cursor?: string): Record<string, unknown> {
  const args: Record<string, unknown> = { limit: LIMIT };
  const s = search.trim();
  if (s) args.search = s;
  if (includeInactive) args.include_inactive = true;
  if (cursor) args.cursor = cursor;
  return args;
}

/** list_office_users' input. */
export function usersArgs(search: string, cursor?: string): Record<string, unknown> {
  const args: Record<string, unknown> = { limit: LIMIT };
  const s = search.trim();
  if (s) args.search = s;
  if (cursor) args.cursor = cursor;
  return args;
}

/** The next page appended to the list shown: a row never twice (by its key), the cursor and the total the page's. */
function appendRows<T>(prev: T[], page: T[], keyOf: (row: T) => string): T[] {
  const seen = new Set(prev.map(keyOf));
  return [...prev, ...page.filter((row) => !seen.has(keyOf(row)))];
}

export function appendDrivers(prev: DriversList, page: DriversList): DriversList {
  const drivers = appendRows(prev.drivers, page.drivers, (d) => d.username);
  const out: DriversList = { ...prev, drivers, count: drivers.length };
  if (page.total !== undefined) out.total = page.total;
  if (page.next) out.next = page.next;
  else delete out.next;
  return out;
}

export function appendUsers(prev: OfficeUsers, page: OfficeUsers): OfficeUsers {
  const users = appendRows(prev.users, page.users, (u) => (u.email ?? '').toLowerCase());
  const out: OfficeUsers = { ...prev, users, count: users.length };
  if (page.total !== undefined) out.total = page.total;
  if (page.next) out.next = page.next;
  else delete out.next;
  return out;
}

/** "D-014 · 077 345 6789" under a driver's name (the code, the phone when the server sent it). */
export function driverLine(d: Pick<Driver, 'code' | 'phone'>, noPhone: string): string {
  return [d.code, d.phone ? phoneDisplay(d.phone) : noPhone].filter(Boolean).join(' · ');
}

/** "on duty since 07:02 · WP KV-7788" / "off duty since 17:52" / the plate alone / the regular one ("WP KV-7788 · regular",
 *  Round 3) / "". */
export function driverLine2(d: Pick<Driver, 'on_duty_since' | 'off_duty_since' | 'current_vehicle' | 'regular_vehicle'>, t: Words): string {
  const duty = d.on_duty_since ? t('office.people.onDutySince', { time: d.on_duty_since }) : d.off_duty_since ? t('office.people.offDutySince', { time: d.off_duty_since }) : '';
  const vehicle = d.current_vehicle ?? (d.regular_vehicle ? `${d.regular_vehicle} · ${t('office.who.regular')}` : '');
  return [duty, vehicle].filter(Boolean).join(' · ');
}

/** The active / switched off pill of a driver or an office user. */
export function activePill(active: boolean | undefined): { key: 'active' | 'off'; tone: Tone } {
  return active === false ? { key: 'off', tone: 'red' } : { key: 'active', tone: 'green' };
}

/** The licence chip's colour (the server's docChip: ok, orange, red; "not set" grey). */
export function licenceTone(chip: string | undefined): Tone {
  return chip === 'ok' ? 'green' : chip === 'orange' ? 'amber' : chip === 'red' ? 'red' : 'muted';
}

/** "sahan@fame.lk · 077 123 4567" under an office user's name. */
export function userLine(u: Pick<OfficeUser, 'email' | 'phone' | 'phone_display'>): string {
  return [u.email ?? '', u.phone_display ?? (u.phone ? phoneDisplay(u.phone) : '')].filter(Boolean).join(' · ');
}

/** The permissions as lower-case words ("view · approve · assign tasks"), never a role name; the screens pass the phone's language. */
export function permissionWords(list: readonly string[] | undefined, word: (p: Permission) => string = (p) => PERMISSION_TEXT[p].label.toLowerCase()): string {
  return normalisePermissions(list).map(word).join(' · ');
}

export const findDriverRow = (list: Pick<DriversList, 'drivers'> | null | undefined, username: string): Driver | undefined =>
  list?.drivers.find((d) => d.username === username);

export const findUserRow = (list: Pick<OfficeUsers, 'users'> | null | undefined, email: string): OfficeUser | undefined =>
  list?.users.find((u) => (u.email ?? '').toLowerCase() === email.toLowerCase());

// ---- Phones (the site's profileLogic: stored +94…, shown "077 123 4567") ----

/** The digits of a Sri Lankan number as +94 and nine digits; null for nothing typed; "bad" for anything else. */
export function phoneE164(text: string | null | undefined): string | null | 'bad' {
  const t = (text ?? '').trim();
  if (!t) return null;
  if (/[^0-9+\s\-()]/.test(t)) return 'bad';
  let d = t.replace(/[^0-9]/g, '');
  if (d.startsWith('0094')) d = d.slice(4);
  else if (d.startsWith('94') && d.length === 11) d = d.slice(2);
  else if (d.startsWith('0') && d.length === 10) d = d.slice(1);
  return /^[1-9]\d{8}$/.test(d) ? `+94${d}` : 'bad';
}

/** The same number however it is written ("077 123 4567" and "+94771234567"); two blanks are the same too. */
export function samePhone(a: string | null | undefined, b: string | null | undefined): boolean {
  const x = phoneE164(a);
  const y = phoneE164(b);
  if (x === 'bad' || y === 'bad') return (a ?? '').trim() === (b ?? '').trim();
  return x === y;
}

/** "+94771234567" → "077 123 4567" (as the office shows numbers); anything else as given. */
export function phoneDisplay(phone: string): string {
  const d = phone.replace(/\D/g, '');
  const local = d.startsWith('94') && d.length === 11 ? `0${d.slice(2)}` : d.length === 10 && d.startsWith('0') ? d : null;
  return local ? `${local.slice(0, 3)} ${local.slice(3, 6)} ${local.slice(6)}` : phone.trim();
}

// ---- A new driver (the site's driverLogic) ----

export interface DriverFields {
  name: string;
  code: string;
  phone: string;
  username: string;
  pin: string;
}

export const emptyDriver = (): DriverFields => ({ name: '', code: '', phone: '', username: '', pin: '' });

export const USERNAME_RULE = /^[A-Za-z0-9._-]{3,40}$/;
export const isPin = (pin: string): boolean => /^\d{6}$/.test(pin);

export type DriverProblem = 'fields' | 'username' | 'pin' | 'phone';

/** create_driver's input, or what is wrong (a code for office.people.driverErr.*). */
export function validateNewDriver(f: DriverFields): { error: DriverProblem } | { input: Record<string, unknown> } {
  const t = (s: string) => s.trim();
  if (!t(f.name) || !t(f.code) || !t(f.username)) return { error: 'fields' };
  if (!USERNAME_RULE.test(t(f.username))) return { error: 'username' };
  if (!isPin(t(f.pin))) return { error: 'pin' };
  if (!t(f.phone)) return { error: 'phone' };
  return { input: { name: t(f.name), code: t(f.code), username: t(f.username), pin: t(f.pin), phone: t(f.phone) } };
}

/** A random 6-digit PIN: the platform's random bytes when it has them, else Math.random (a PIN told by phone). */
export function randomPin(random: () => number = defaultRandom): string {
  return String(Math.floor(random() * 1_000_000) % 1_000_000).padStart(6, '0');
}

function defaultRandom(): number {
  const c = (globalThis as { crypto?: { getRandomValues?: (a: Uint32Array) => Uint32Array } }).crypto;
  if (c?.getRandomValues) {
    const a = new Uint32Array(1);
    c.getRandomValues(a);
    return a[0] / 4_294_967_296;
  }
  return Math.random();
}

// ---- The driver's details (the site's driverProfileLogic) ----

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

export const PROFILE_KEYS: readonly (keyof ProfileFields)[] = ['phone', 'whatsapp', 'emergency_name', 'emergency_relation', 'emergency_phone', 'licence_no', 'licence_expiry'];

/** The profile answer carries the private part (the emergency contact, the licence, the changes) for this person. */
export const seesPrivate = (p: DriverProfile | null | undefined): boolean => !!p && p.licence !== undefined && !p.private_hidden;

/** The fields the editor shows for this person: WhatsApp only with the profile, the private ones only with the private part. */
export function editableFields(p: DriverProfile | null | undefined): (keyof ProfileFields)[] {
  const priv = seesPrivate(p);
  return PROFILE_KEYS.filter((k) => {
    if (k === 'whatsapp') return !!p;
    if (k === 'licence_no' || k === 'emergency_name' || k === 'emergency_relation' || k === 'emergency_phone') return priv;
    return true;
  });
}

/** The fields as the editor starts them: the profile's (the numbers as shown), else the list row's. */
export function profileFields(p: DriverProfile | null | undefined, row?: Pick<Driver, 'phone' | 'licence'> | null): ProfileFields {
  if (!p) {
    return {
      phone: row?.phone ? phoneDisplay(row.phone) : '',
      whatsapp: '',
      emergency_name: '',
      emergency_relation: '',
      emergency_phone: '',
      licence_no: '',
      licence_expiry: row?.licence?.expiry ?? '',
    };
  }
  return {
    phone: p.driver.phone_display ?? p.driver.phone ?? '',
    whatsapp: p.driver.whatsapp_display ?? p.driver.whatsapp ?? '',
    emergency_name: p.emergency?.name ?? '',
    emergency_relation: p.emergency?.relation ?? '',
    emergency_phone: p.emergency?.phone_display ?? p.emergency?.phone ?? '',
    licence_no: p.licence?.number ?? '',
    licence_expiry: p.licence?.expiry ?? p.driver.licence_chip?.expiry ?? '',
  };
}

export type ProfilePatch = Partial<Record<keyof ProfileFields, string | null>>;
export type ProfileProblem = 'phoneEmpty' | 'licenceDate';

/**
 * update_driver's fields with only what changed among `keys`: a changed field sends its new text (trimmed), an emptied one
 * null; a phone written another way is no change. The phone cannot be emptied; a licence expiry must be a date.
 */
export function profilePatch(before: ProfileFields, after: ProfileFields, keys: readonly (keyof ProfileFields)[] = PROFILE_KEYS): { patch: ProfilePatch } | { error: ProfileProblem } {
  const patch: ProfilePatch = {};
  for (const k of keys) {
    const was = before[k].trim();
    const now = after[k].trim();
    if (now === was) continue;
    if ((k === 'phone' || k === 'whatsapp' || k === 'emergency_phone') && samePhone(now, was)) continue;
    if (k === 'phone' && !now) return { error: 'phoneEmpty' };
    if (k === 'licence_expiry' && now && !/^\d{4}-\d{2}-\d{2}$/.test(now)) return { error: 'licenceDate' };
    patch[k] = now || null;
  }
  return { patch };
}

/** update_driver's input for a patch. */
export const updateDriverInput = (username: string, patch: ProfilePatch): Record<string, unknown> => ({ username, ...patch });

/** When the driver last changed their own phone in the app (the amber line of design 20), or null. */
export function latestDriverPhoneChange(changes: DriverProfile['changes'] | undefined): string | null {
  const hit = (changes ?? []).find((c) => c.by_driver && c.field === 'phone');
  return hit ? hit.at : null;
}

/** How many licence photos the private part holds (0, 1 or 2). */
export const licencePhotos = (licence: DriverProfile['licence'] | undefined): number => (licence ? [licence.front_url, licence.back_url].filter(Boolean).length : 0);

export interface DateNames {
  days: string[];
  months: string[];
}

/** "2027-03-12" → "12 Mar 2027" (the names in the language shown; anything else as given). */
export function longDate(names: DateNames, date: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return date;
  return `${Number(m[3])} ${names.months[Number(m[2]) - 1] ?? ''} ${m[1]}`.replace(/\s+/g, ' ').trim();
}

/** "2026-10-18 22:40" (the server's Colombo date-time) → "Sun 18 Oct 22:40"; anything else as given. */
export function whenText(names: DateNames, at: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}:\d{2})$/.exec(at);
  if (!m) return at;
  const weekday = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))).getUTCDay();
  return `${names.days[weekday] ?? ''} ${Number(m[3])} ${names.months[Number(m[2]) - 1] ?? ''} ${m[4]}`.replace(/\s+/g, ' ').trim();
}

/** The licence as the page shows it: the expiry (YYYY-MM-DD) and the chip from the profile, else the list row. */
export function licenceOf(p: DriverProfile | null | undefined, row: Pick<Driver, 'licence'> | null | undefined): { expiry: string | null; chip: string } {
  if (p?.licence) return { expiry: p.licence.expiry ?? null, chip: p.licence.chip };
  if (p?.driver.licence_chip) return { expiry: p.driver.licence_chip.expiry, chip: p.driver.licence_chip.chip };
  if (row?.licence?.expiry) return { expiry: row.licence.expiry, chip: row.licence.chip ?? 'ok' };
  return { expiry: null, chip: 'not set' };
}

/** "Sunethra (wife) · 071 222 3344" or "". */
export function emergencyText(e: DriverProfile['emergency'] | undefined): string {
  if (!e) return '';
  const who = e.name ? (e.relation ? `${e.name} (${e.relation})` : e.name) : e.relation ?? '';
  return [who, e.phone_display ?? e.phone ?? ''].filter(Boolean).join(' · ');
}

/** The regular vehicle of a driver among the vehicles (list_vehicles' regular_driver is the driver's name). */
export function regularVehicleOf<V extends { reg_no: string; make_model?: string; regular_driver?: string }>(vehicles: readonly V[] | undefined, name: string): V | undefined {
  const key = name.trim().toLowerCase();
  return key ? vehicles?.find((v) => (v.regular_driver ?? '').trim().toLowerCase() === key) : undefined;
}

// ---- Office users (the site's usersLogic) ----

export type Preset = keyof typeof PRESETS;
export const PRESET_KEYS = Object.keys(PRESETS) as Preset[];

export interface UserFields {
  name: string;
  email: string;
  phone: string;
  permissions: Permission[];
}

export const emptyUser = (): UserFields => ({ name: '', email: '', phone: '', permissions: [...PRESETS.viewer.permissions] });

/** True while a permission that needs view is ticked: the view chip is then on and locked. */
export const viewLocked = (list: readonly Permission[]): boolean => list.some((p) => IMPLIES_VIEW.includes(p));

/** Adds or removes one permission, keeping the table's order; view comes with any other and cannot leave while one is on. */
export function togglePermission(list: readonly Permission[], p: Permission): Permission[] {
  const set = new Set(list);
  if (p === 'view' && viewLocked(list)) set.add('view');
  else if (set.has(p)) set.delete(p);
  else set.add(p);
  if (viewLocked([...set])) set.add('view');
  return PERMISSIONS.filter((x) => set.has(x));
}

/** The preset that matches the list exactly, "all" for everything (the Everything chip), else null. */
export function presetOf(list: readonly Permission[]): Preset | 'all' | null {
  const sorted = normalisePermissions(list).join(',');
  // Everything: every permission; office_users is optional beside users (users covers office accounts; Round 2b).
  if (sorted === PERMISSIONS.join(',') || sorted === PERMISSIONS.filter((p) => p !== 'office_users').join(',')) return 'all';
  for (const key of PRESET_KEYS) {
    if (PRESETS[key].permissions.join(',') === sorted) return key;
  }
  return null;
}

/** True when the person is editing their own account's permissions (Round 2b: nobody changes their own; the server refuses it too). */
export function selfLockout(meEmail: string | undefined, userEmail: string, _permissions?: readonly Permission[]): boolean {
  return !!meEmail && meEmail.toLowerCase() === userEmail.toLowerCase();
}

export type UserProblem = 'fields' | 'email' | 'permissions' | 'permissionsOff' | 'selfLockout';

/** create_office_user's input, or what is wrong (a code for office.people.userErr.*). */
export function validateNewUser(f: UserFields): { error: UserProblem } | { input: Record<string, unknown> } {
  const t = (s: string) => s.trim();
  if (!t(f.name) || !t(f.email)) return { error: 'fields' };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t(f.email))) return { error: 'email' };
  if (f.permissions.length === 0) return { error: 'permissions' };
  const input: Record<string, unknown> = { name: t(f.name), email: t(f.email).toLowerCase(), permissions: normalisePermissions(f.permissions) };
  if (t(f.phone)) input.phone = t(f.phone);
  return { input };
}

/** Only what changed goes to update_office_user; nothing changed = no call. */
export function updateUserInput(
  before: { email: string; name: string; phone?: string | null; permissions: readonly Permission[] },
  f: UserFields,
  meEmail?: string,
): { error: UserProblem } | { input: Record<string, unknown> } | { nothing: true } {
  const t = (s: string) => s.trim();
  const input: Record<string, unknown> = { email: before.email };
  if (t(f.name) && t(f.name) !== before.name) input.name = t(f.name);
  if (!samePhone(f.phone, before.phone)) input.phone = t(f.phone) || null;
  const perms = normalisePermissions(f.permissions);
  if (perms.join(',') !== normalisePermissions(before.permissions).join(',')) {
    if (perms.length === 0) return { error: 'permissionsOff' };
    if (selfLockout(meEmail, before.email, perms)) return { error: 'selfLockout' };
    input.permissions = perms;
  }
  if (Object.keys(input).length === 1) return { nothing: true };
  return { input };
}

/** The user's fields as the editor starts them (the number as shown). */
export function userFields(u: OfficeUser, email: string): UserFields {
  return { name: u.name, email, phone: u.phone_display ?? (u.phone ? phoneDisplay(u.phone) : ''), permissions: normalisePermissions(u.permissions) };
}

// ---- Quick settings (design 19's card as a page) ----

/** Round 4–7 (phase8-plan.md §33): the five feature switches, on by default (absent = on). */
export const FEATURE_KEYS = ['vehicle_check', 'trip_close_prompt', 'fuel_card', 'passengers', 'holder_contact'] as const;
export type FeatureKey = (typeof FEATURE_KEYS)[number];
export type SwitchKey = 'tasks_need_approval' | 'vehicle_on_the_day' | 'planner_suggestions' | FeatureKey;

export type QuickKey = 'tasks_need_approval' | 'vehicle_on_the_day' | 'planner_suggestions' | 'driver_personal_trips' | 'duty_cutoff' | 'accept_within_min' | 'accept_before_leave_min' | 'office_phone' | FeatureKey;
export type SettingKind = 'switch' | 'choice' | 'time' | 'minutes' | 'phone';

export interface QuickRow {
  key: QuickKey;
  kind: SettingKind;
}

/** The rows in the design's order, then the accept window and the office phone (section 4 of the plan). */
export const QUICK_SETTINGS: readonly QuickRow[] = [
  { key: 'tasks_need_approval', kind: 'switch' },
  { key: 'vehicle_on_the_day', kind: 'switch' },
  { key: 'planner_suggestions', kind: 'switch' },
  { key: 'driver_personal_trips', kind: 'choice' },
  { key: 'duty_cutoff', kind: 'time' },
  { key: 'accept_within_min', kind: 'minutes' },
  { key: 'accept_before_leave_min', kind: 'minutes' },
  { key: 'office_phone', kind: 'phone' },
  // Round 4–7: the feature switches, a group of their own on the page (Features).
  ...FEATURE_KEYS.map((key) => ({ key, kind: 'switch' as const })),
];

export const PERSONAL_TRIPS = ['allowed', 'default', 'off', 'ask_first'] as const;
export type PersonalTrips = (typeof PERSONAL_TRIPS)[number];

export const isTime = (v: unknown): v is string => typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v);

type Partial2 = Partial<FleetSettings> | null | undefined;

/** The personal trips choice shown: the saved one, else the server's default, else allowed. */
export function personalTripsValue(saved?: string | null, fallback?: string | null): PersonalTrips {
  const known = (v?: string | null): v is PersonalTrips => (PERSONAL_TRIPS as readonly string[]).includes(v ?? '');
  return known(saved) ? saved : known(fallback) ? fallback : 'allowed';
}

/**
 * A switch as shown: the saved value, else the server's default, else the site's (approval on, vehicle on the day off;
 * Round 4–7: the five features on).
 */
export function switchValue(key: SwitchKey, settings: Partial2, defaults?: Partial2): boolean {
  const v = settings?.[key] ?? defaults?.[key];
  return typeof v === 'boolean' ? v : key !== 'vehicle_on_the_day';
}

/** The auto clock-out as shown: "" = off. */
export function cutoffValue(settings: Partial2, defaults?: Partial2): string {
  const v = settings?.duty_cutoff ?? defaults?.duty_cutoff;
  return typeof v === 'string' ? v : '21:00';
}

const MINUTES_FALLBACK: Record<'accept_within_min' | 'accept_before_leave_min', number> = { accept_within_min: 15, accept_before_leave_min: 30 };

export function minutesValue(key: 'accept_within_min' | 'accept_before_leave_min', settings: Partial2, defaults?: Partial2): number {
  const v = settings?.[key] ?? defaults?.[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : MINUTES_FALLBACK[key];
}

/** The office phone as typed into the field ("077 123 4567"), "" when none. */
export function officePhoneValue(settings: Partial2): string {
  const v = settings?.office_phone;
  return v ? phoneDisplay(v) : '';
}

export type SettingProblem = 'time' | 'minutes' | 'phone' | 'choice';

/**
 * update_settings' input for a row from what the person set: a switch's boolean, a choice among the four, a time ("" =
 * off), whole minutes 1–1440 from the text, a Sri Lankan number as +94… (empty = null); or what is wrong.
 */
export function settingInput(row: QuickRow, raw: unknown): { input: { key: QuickKey; value: unknown } } | { error: SettingProblem } {
  switch (row.kind) {
    case 'switch':
      return { input: { key: row.key, value: raw === true } };
    case 'choice':
      return (PERSONAL_TRIPS as readonly string[]).includes(String(raw)) ? { input: { key: row.key, value: String(raw) } } : { error: 'choice' };
    case 'time': {
      const v = typeof raw === 'string' ? raw.trim() : '';
      return v === '' || isTime(v) ? { input: { key: row.key, value: v } } : { error: 'time' };
    }
    case 'minutes': {
      const text = typeof raw === 'number' ? String(raw) : typeof raw === 'string' ? raw.trim() : '';
      if (!/^\d{1,4}$/.test(text)) return { error: 'minutes' };
      const n = Number(text);
      return n >= 1 && n <= 1440 ? { input: { key: row.key, value: n } } : { error: 'minutes' };
    }
    case 'phone': {
      const v = phoneE164(typeof raw === 'string' ? raw : '');
      return v === 'bad' ? { error: 'phone' } : { input: { key: row.key, value: v } };
    }
  }
}

/** The settings with one value saved (the screen shows the answer at once, the server confirmed it). */
export function withSetting(settings: FleetSettings, key: QuickKey, value: unknown): FleetSettings {
  return { ...settings, [key]: value } as FleetSettings;
}

/** Round 2b (the server's accountGuards.ts ADMIN_MANAGED): an account holding any of these is the admins' to change. */
export const ADMIN_MANAGED = ['office_users', 'users', 'approve'] as const;
const managed = (p: string) => (ADMIN_MANAGED as readonly string[]).includes(p);

/**
 * Round 2b (the server's accountGuards.ts, the same rule): may this person change that office account? Not an admin's
 * without users; for someone who is not an admin (Google Workspace's help-desk rule) not one holding Office accounts,
 * Users or Approve, nor one holding any permission they could not give (users covers office_users). Their own account:
 * always (its name and phone; never its permissions, refused by selfLockout and the server).
 */
export function canChangeAccount(me: { email?: string; permissions: readonly string[] }, target: { email?: string | null; permissions: readonly string[] }): boolean {
  if (me.email && target.email && me.email.toLowerCase() === target.email.toLowerCase()) return true;
  const admin = me.permissions.includes('users');
  if (!admin && target.permissions.some(managed)) return false;
  const held = new Set(admin ? [...me.permissions, 'office_users'] : me.permissions);
  return target.permissions.every((p) => held.has(p));
}

/** What this person may tick on an account form (the server's givablePermissions): an admin what they hold and Office accounts; anyone else what they hold except Office accounts, Users and Approve. */
export function givablePermissions(perms: readonly string[]): string[] {
  return perms.includes('users') ? [...new Set([...perms, 'office_users'])] : perms.filter((p) => !managed(p));
}
