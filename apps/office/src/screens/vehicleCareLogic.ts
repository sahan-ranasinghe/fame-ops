// Maintenance and Reminders as Fleetio shows them (Round 4–7, item 8, §33.7): ONLY service and documents, one card per
// vehicle: the service due by km and by date with a bar, and the documents' expiries as chips (ok / expiring / expired /
// missing). Missed tasks, odometer checks and every other issue live in Issues only. Pure, from list_vehicles' cards
// (next_service "In 1,120 km or 2 Nov", service_state, the lic / ins / emi chips with days_left, the documents missing,
// rent_until, garage_booked). The app's twin: apps/driver/src/office/vehicleCareLogic.ts (the same rules; words as keys).
//
// The bar: list_vehicles sends the km and the date to the service, not the interval, so the bar fills over the last
// KM_SCALE km and DAY_SCALE days before it (whichever is nearer), full at due; its colour is the server's state.
import type { DocKind, VehicleCard } from "../data/types";

export type CareDocKind = DocKind | "rental";
export type DocState = "ok" | "expiring" | "expired" | "missing" | "no_date";
export type ServiceState = "ok" | "due_soon" | "overdue" | "not_set";

export interface CareDoc {
  kind: CareDocKind;
  state: DocState;
  /** YYYY-MM-DD */
  expiry?: string;
  /** Days left (negative = past). */
  days?: number;
}

export interface CareService {
  state: ServiceState;
  /** Km to the service (negative = over). */
  km?: number;
  /** YYYY-MM-DD */
  date?: string;
  days?: number;
  /** 0–1, full when due. */
  fill: number;
  /** "2026-10-23": the garage is booked. */
  garage?: string;
}

export interface VehicleCare {
  reg_no: string;
  make_model?: string;
  thumb_url?: string;
  in_garage?: boolean;
  service: CareService;
  docs: CareDoc[];
  /** 2 = overdue or expired, 1 = due soon, expiring or missing, 0 = in order. */
  level: 0 | 1 | 2;
  /** The nearest day anything is due (for the order). */
  soonest: number;
}

/** The bar's span before a service: the last 5,000 km or 90 days. */
export const KM_SCALE = 5000;
export const DAY_SCALE = 90;
/** A document chip turns amber 30 days before its expiry (the server's chips: orange within 30, red within 7). */
export const EXPIRING_DAYS = 30;
/** Reminders: what is due within this many days (fleet_overview's window). */
export const REMINDER_DAYS = 14;

export const DOC_NAME: Record<CareDocKind, string> = {
  revenue_licence: "Revenue licence",
  insurance: "Insurance",
  emission: "Emission test",
  registration: "Registration (CR)",
  lease: "Lease",
  other: "Other",
  rental: "Rental",
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAY_MS = 86_400_000;

/** Whole days from one plain date to another (negative when `to` is earlier). */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);
}

/** "2 Nov" (no year) as the date nearest to today: within half a year either side. */
function nearestDate(day: number, month: number, today: string): string {
  const year = Number(today.slice(0, 4));
  const pad = (n: number) => String(n).padStart(2, "0");
  const candidates = [year - 1, year, year + 1].map((y) => `${y}-${pad(month)}-${pad(day)}`);
  return candidates.reduce((best, d) => (Math.abs(daysBetween(today, d)) < Math.abs(daysBetween(today, best)) ? d : best));
}

/** The server's service words read back: "In 1,120 km or 2 Nov", "320 km over or 2 Nov", "2 Nov", "Not set". */
export function readService(text: string | undefined, today: string): { km?: number; date?: string } {
  const s = String(text ?? "");
  const out: { km?: number; date?: string } = {};
  const ahead = s.match(/In ([\d,]+) km/i);
  const over = s.match(/([\d,]+) km over/i);
  if (ahead) out.km = Number(ahead[1].replace(/,/g, ""));
  else if (over) out.km = -Number(over[1].replace(/,/g, ""));
  const d = s.match(/\b(\d{1,2}) (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b/);
  if (d) out.date = nearestDate(Number(d[1]), MONTHS.indexOf(d[2]) + 1, today);
  return out;
}

const clamp = (n: number) => Math.max(0, Math.min(1, n));

/** The service: the server's state, the km and the date read back, the bar. */
export function serviceOf(v: Pick<VehicleCard, "next_service" | "service_state" | "garage_booked">, today: string): CareService {
  const raw = String(v.service_state ?? "").toLowerCase();
  const state: ServiceState = raw === "overdue" ? "overdue" : raw === "due soon" ? "due_soon" : raw === "ok" ? "ok" : "not_set";
  const { km, date } = readService(v.next_service, today);
  const days = date ? daysBetween(today, date) : undefined;
  const fills = [km !== undefined ? clamp(1 - km / KM_SCALE) : -1, days !== undefined ? clamp(1 - days / DAY_SCALE) : -1];
  const fill = state === "overdue" ? 1 : Math.max(0, ...fills);
  const garage = v.garage_booked && daysBetween(today, v.garage_booked) >= 0 ? v.garage_booked : undefined;
  return { state, ...(km !== undefined ? { km } : {}), ...(date ? { date, days } : {}), fill: state === "not_set" ? 0 : fill, ...(garage ? { garage } : {}) };
}

function dated(kind: CareDocKind, expiry: string | undefined, days: number | undefined, missing: boolean): CareDoc {
  if (expiry && days !== undefined) {
    const state: DocState = days < 0 ? "expired" : days <= EXPIRING_DAYS ? "expiring" : missing ? "missing" : "ok";
    return { kind, state, expiry, days };
  }
  return { kind, state: missing ? "missing" : "no_date" };
}

/**
 * The documents as chips: the revenue licence, the insurance and the emission test with their dates (expired before
 * expiring before missing before no date), the other kinds only when one is missing or held, and the rental's end.
 */
export function docsOf(v: Pick<VehicleCard, "documents" | "documents_missing" | "document_files" | "rent_until">, today: string): CareDoc[] {
  const missing = new Set(v.documents_missing ?? []);
  const held = new Set((v.document_files ?? []).map((d) => d.kind));
  const d = v.documents ?? {};
  const out: CareDoc[] = [
    dated("revenue_licence", d.lic?.expiry, d.lic?.days_left ?? (d.lic?.expiry ? daysBetween(today, d.lic.expiry) : undefined), missing.has("revenue_licence")),
    dated("insurance", d.ins?.expiry, d.ins?.days_left ?? (d.ins?.expiry ? daysBetween(today, d.ins.expiry) : undefined), missing.has("insurance")),
    dated("emission", d.emi?.expiry, d.emi?.days_left ?? (d.emi?.expiry ? daysBetween(today, d.emi.expiry) : undefined), missing.has("emission")),
  ];
  for (const kind of ["registration", "lease"] as const) {
    if (missing.has(kind)) out.push({ kind, state: "missing" });
    else if (held.has(kind)) out.push({ kind, state: "ok" });
  }
  if (v.rent_until) {
    const days = daysBetween(today, v.rent_until);
    out.push({ kind: "rental", state: days < 0 ? "expired" : days <= EXPIRING_DAYS ? "expiring" : "ok", expiry: v.rent_until, days });
  }
  return out;
}

/** One vehicle's card. */
export function careOf(v: VehicleCard, today: string): VehicleCare {
  const service = serviceOf(v, today);
  const docs = docsOf(v, today);
  const level: 0 | 1 | 2 = service.state === "overdue" || docs.some((d) => d.state === "expired")
    ? 2
    : service.state === "due_soon" || docs.some((d) => d.state === "expiring" || d.state === "missing")
    ? 1
    : 0;
  const days = [service.days, service.km !== undefined && service.km <= 0 ? -1 : undefined, ...docs.filter((d) => d.state !== "ok").map((d) => d.days ?? 0)]
    .filter((n): n is number => n !== undefined);
  return {
    reg_no: v.reg_no,
    ...(v.make_model ? { make_model: v.make_model } : {}),
    ...(v.thumb_url ? { thumb_url: v.thumb_url } : {}),
    ...(v.in_garage ? { in_garage: true } : {}),
    service,
    docs,
    level,
    soonest: days.length ? Math.min(...days) : 9999,
  };
}

/** The active vehicles' cards, the most urgent first (overdue or expired, then due soon, then in order; the soonest first). */
export function careCards(vehicles: readonly VehicleCard[], today: string): VehicleCare[] {
  return vehicles
    .filter((v) => v.active !== false)
    .map((v) => careOf(v, today))
    .sort((a, b) => b.level - a.level || a.soonest - b.soonest || a.reg_no.localeCompare(b.reg_no));
}

/** Due within the reminders' window: the service due soon or overdue, a document expired, missing or ending within it. */
export function isDue(c: VehicleCare, windowDays = REMINDER_DAYS): boolean {
  if (c.service.state === "overdue" || c.service.state === "due_soon") return true;
  return c.docs.some((d) => d.state === "expired" || d.state === "missing" || (d.state === "expiring" && (d.days ?? 0) <= windowDays));
}

export interface CareCounts {
  vehicles: number;
  attention: number;
  serviceOverdue: number;
  serviceSoon: number;
  expired: number;
  expiring: number;
  missing: number;
}

/** The summary above the cards. */
export function careCounts(cards: readonly VehicleCare[]): CareCounts {
  const docs = cards.flatMap((c) => c.docs);
  return {
    vehicles: cards.length,
    attention: cards.filter((c) => c.level > 0).length,
    serviceOverdue: cards.filter((c) => c.service.state === "overdue").length,
    serviceSoon: cards.filter((c) => c.service.state === "due_soon").length,
    expired: docs.filter((d) => d.state === "expired").length,
    expiring: docs.filter((d) => d.state === "expiring").length,
    missing: docs.filter((d) => d.state === "missing").length,
  };
}

/** "2 services overdue · 3 due soon · 1 document expired · 4 expiring · 2 missing" (only what is there). */
export function summaryText(c: CareCounts): string {
  const n = (k: number, one: string, many = `${one}s`) => (k ? `${k} ${k === 1 ? one : many}` : "");
  const parts = [
    n(c.serviceOverdue, "service overdue", "services overdue"),
    c.serviceSoon ? `${c.serviceSoon} service${c.serviceSoon === 1 ? "" : "s"} due soon` : "",
    n(c.expired, "document expired", "documents expired"),
    n(c.expiring, "document expiring", "documents expiring"),
    n(c.missing, "document missing", "documents missing"),
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : "Every service and document is in order.";
}

/** The chip's words: "Insurance · 12 Nov", "Revenue licence · expired 3 d ago", "Emission test · missing". */
export function docWords(d: CareDoc, dayText: (date: string) => string): string {
  const name = DOC_NAME[d.kind];
  switch (d.state) {
    case "expired":
      return `${name} · ${d.kind === "rental" ? "ended" : "expired"} ${dayText(d.expiry ?? "")}`;
    case "expiring":
      return `${name} · ${d.days === 0 ? "today" : d.days === 1 ? "tomorrow" : `in ${d.days} days`}`;
    case "missing":
      return `${name} · missing`;
    case "no_date":
      return `${name} · no date`;
    default:
      return d.expiry ? `${name} · ${dayText(d.expiry)}` : name;
  }
}

/** The service's words: "In 1,120 km or Sun 2 Nov", "320 km over", "Not set". */
export function serviceWords(s: CareService, dayText: (date: string) => string): string {
  const parts: string[] = [];
  if (s.km !== undefined) parts.push(s.km > 0 ? `In ${s.km.toLocaleString("en-US")} km` : `${(-s.km).toLocaleString("en-US")} km over`);
  if (s.date) parts.push(`${parts.length ? "or " : ""}${dayText(s.date)}`);
  return parts.length ? parts.join(" ") : "Not set";
}

/** The tones of the site's chips and bars. */
export const docTone = (s: DocState): "ok" | "warn" | "bad" | "" => (s === "expired" ? "bad" : s === "expiring" || s === "missing" ? "warn" : s === "ok" ? "ok" : "");
export const serviceTone = (s: ServiceState): "ok" | "warn" | "bad" | "" => (s === "overdue" ? "bad" : s === "due_soon" ? "warn" : s === "ok" ? "ok" : "");
