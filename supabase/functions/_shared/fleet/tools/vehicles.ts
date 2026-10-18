// Vehicles: list with km / service / documents / status, register, update,
// and rental companies.

import { z } from "zod";
import type { Update } from "../db.ts";
import { ToolError, unwrap } from "../db.ts";
import {
  docChip,
  findDriver,
  findPerson,
  findVehicle,
  loadRefs,
  monthKm,
  normalisePlate,
  type Refs,
  service,
  type Vehicle,
  vehicleStatus,
} from "../fleet.ts";
import { centsToLkr, contactLinks, lkrToCents } from "../format.ts";
import { colomboDate, colomboTime } from "../time.ts";
import { vehiclePhotoLinks } from "../media.ts";
import { documentsOf } from "./media.ts";
import { missingText, requiredKinds } from "../docs.ts";
import { realDate, tool, zDate, zText, zVehicleType } from "../tool.ts";

const vehicleFields = {
  make_model: zText(80).describe('Make and model, e.g. "Toyota HiAce"'),
  vehicle_type: zVehicleType,
  seats: z.number().int().min(1).max(80),
  rental_company: zText(120).describe("Rental company name (add it first with add_rental_company)"),
  rent_until: zDate.describe("Rental agreement end date"),
  monthly_rent_lkr: z.number().min(0).describe("Monthly rent in LKR"),
  monthly_km_allowance: z.number().int().min(0).describe("Km included per month"),
  regular_driver: zText(80).describe("Username, code or name of the usual driver"),
  current_odometer_km: z.number().int().min(0),
  service_interval_km: z.number().int().min(1),
  last_service_odometer_km: z.number().int().min(0),
  next_service_date: zDate,
  licence_expiry: zDate.describe("Revenue licence expiry"),
  insurance_expiry: zDate,
  emission_expiry: zDate.describe("Emission test expiry"),
  custodian: zText(120).describe("The office person who keeps this vehicle (name or e-mail): it shows as assigned to them"),
  custodian_note: zText(200).describe('A note about the custody, e.g. "Keeps it at Rajagiriya"'),
};
type VehicleField = keyof typeof vehicleFields;

/** Every field optional, and null allowed (null clears the value). */
function clearable<T extends z.ZodRawShape>(shape: T) {
  return Object.fromEntries(
    Object.entries(shape).map(([key, schema]) => [key, (schema as z.ZodType).nullable().optional()]),
  ) as unknown as { [K in keyof T]: z.ZodOptional<z.ZodNullable<T[K]>> };
}

const DATE_FIELDS = ["rent_until", "next_service_date", "licence_expiry", "insurance_expiry", "emission_expiry"] as const;
const SAME_NAME_FIELDS = [
  "make_model",
  "vehicle_type",
  "seats",
  "rent_until",
  "monthly_km_allowance",
  "current_odometer_km",
  "service_interval_km",
  "last_service_odometer_km",
  "next_service_date",
  "licence_expiry",
  "insurance_expiry",
  "emission_expiry",
  "custodian_note",
] as const;

/** Turns the tool's fields into table columns. Only fields that were sent are included. */
function toColumns(args: Partial<Record<VehicleField, unknown>>, refs: Refs): Update<"vehicles"> {
  const columns: Record<string, unknown> = {};
  for (const field of DATE_FIELDS) {
    if (typeof args[field] === "string") realDate(args[field], field);
  }
  for (const field of SAME_NAME_FIELDS) {
    if (args[field] !== undefined) columns[field] = args[field];
  }
  if (args.monthly_rent_lkr !== undefined) {
    columns.monthly_rent_cents = args.monthly_rent_lkr === null ? null : lkrToCents(args.monthly_rent_lkr as number);
  }
  if (args.rental_company !== undefined) {
    columns.rental_company_id = args.rental_company === null ? null : findCompany(refs, args.rental_company as string).id;
  }
  if (args.regular_driver !== undefined) {
    columns.regular_driver_id = args.regular_driver === null ? null : findDriver(refs, args.regular_driver as string).id;
  }
  if (args.custodian !== undefined) {
    columns.custodian_employee_id = args.custodian === null ? null : findPerson(refs, args.custodian as string).id;
  }
  return columns as Update<"vehicles">;
}

function findCompany(refs: Refs, typed: string) {
  const want = typed.trim().toLowerCase();
  const all = [...refs.company.values()];
  const exact = all.filter((c) => c.name.toLowerCase() === want);
  const matches = exact.length > 0 ? exact : all.filter((c) => c.name.toLowerCase().includes(want));
  if (matches.length === 1) return matches[0];
  if (matches.length === 0) throw new ToolError(`No rental company matches "${typed}". Add it with add_rental_company.`);
  throw new ToolError(`"${typed}" matches more than one rental company: ${matches.map((c) => c.name).join("; ")}.`);
}

/** A task that keeps a vehicle busy, as availabilityOf reads it. */
export interface VehicleBusy {
  status: string;
  start_at: string;
  end_by: string | null;
  /** The live ETA of a running task (task_eta.final_eta_at), when there is one. */
  final_eta_at?: string | null;
}

/** "Free", "On a task · back ~HH:MM (planned | live)", "Booked later today · HH:MM", "In garage". Pure. */
export function availabilityOf(
  inGarage: boolean,
  tasks: VehicleBusy[],
  now: Date,
): { availability: string; back_at?: string; back_source?: "planned" | "live" } {
  if (inGarage) return { availability: "In garage" };
  const running = tasks.find((t) => t.status === "in_progress");
  if (running) {
    const live = running.final_eta_at && new Date(running.final_eta_at) > now ? running.final_eta_at : null;
    if (live) return { availability: `On a task · back ~${colomboTime(live)} (live)`, back_at: colomboTime(live), back_source: "live" };
    if (running.end_by) {
      return {
        availability: `On a task · back ~${colomboTime(running.end_by)} (planned)`,
        back_at: colomboTime(running.end_by),
        back_source: "planned",
      };
    }
    return { availability: "On a task · end time not set" };
  }
  const today = colomboDate(now);
  const booked = tasks.filter((t) => t.status === "assigned" && colomboDate(t.start_at) === today)
    .sort((a, b) => a.start_at.localeCompare(b.start_at))[0];
  if (booked) {
    return new Date(booked.start_at) > now
      ? { availability: `Booked later today · ${colomboTime(booked.start_at)}` }
      : { availability: `Booked · ${colomboTime(booked.start_at)} (not started yet)` };
  }
  return { availability: "Free" };
}

function vehicleCard(v: Vehicle, refs: Refs, today: string) {
  const company = v.rental_company_id ? refs.company.get(v.rental_company_id) : undefined;
  const custodian = v.custodian_employee_id ? refs.emp.get(v.custodian_employee_id) : undefined;
  const svc = service(v, today);
  return {
    reg_no: v.reg_no,
    make_model: v.make_model,
    type: v.vehicle_type,
    seats: v.seats,
    rented_from: company?.name,
    rent_until: v.rent_until,
    monthly_rent_lkr: centsToLkr(v.monthly_rent_cents),
    regular_driver: v.regular_driver_id ? refs.emp.get(v.regular_driver_id)?.name : undefined,
    assigned_to: custodian?.name,
    assigned_to_links: custodian ? contactLinks(custodian.phone) : undefined,
    custodian_note: custodian ? v.custodian_note ?? undefined : undefined,
    odometer_km: v.current_odometer_km,
    km_allowance: v.monthly_km_allowance,
    // Hotfix 3 (L2): none set (null or 0) is said so, and never checked.
    km_allowance_note: v.monthly_km_allowance ? undefined : "no km allowance set",
    next_service: svc.text,
    service_state: svc.state,
    garage_booked: v.garage_booked_date,
    documents: {
      lic: docChip(v.licence_expiry, today),
      ins: docChip(v.insurance_expiry, today),
      emi: docChip(v.emission_expiry, today),
    },
    active: v.active ? undefined : false,
  };
}

export const listVehicles = tool({
  name: "list_vehicles",
  title: "List vehicles",
  description: "Vehicles with rental company, regular driver, who it is assigned to (the custodian, with call and WhatsApp links), " +
    "km this month against the allowance, next service, document chips (lic = revenue licence, ins = insurance, emi = emission test; " +
    "orange = expires within 30 days, red = within 7 days or expired), status and availability (Free, On a task · back ~HH:MM, " +
    "Booked later today · HH:MM, In garage), and the driver who holds it now (held_by, since held_since: one vehicle, one driver).",
  readOnly: true,
  input: z.object({
    filter: z.enum(["all", "on_task", "available", "in_garage", "documents_expiring", "inactive"]).optional()
      .describe("Default: all active vehicles"),
  }),
  async run({ filter = "all" }, { db, now }) {
    const today = colomboDate(now);
    const refs = await loadRefs(db);
    const active = refs.vehicles.filter((v) => v.active);
    const dayStart = new Date(`${today}T00:00:00+05:30`).toISOString();
    const [running, km, booked, holdersRes] = await Promise.all([
      db.from("tasks").select("id, vehicle_id, status, start_at, end_by").eq("status", "in_progress"),
      monthKm(db, active.map((v) => v.id), today.slice(0, 7)),
      db.from("tasks").select("id, vehicle_id, status, start_at, end_by").eq("status", "assigned").gte("start_at", dayStart),
      // Phase 7: who holds each vehicle now (vehicle_assignments: one vehicle, one driver).
      db.from("vehicle_assignments").select("employee_id, vehicle_id, from_at").is("to_at", null),
    ]);
    const holders = new Map(unwrap(holdersRes, "vehicle holders").map((a) => [a.vehicle_id, a]));
    const runningTasks = unwrap(running, "tasks");
    const onTask = new Set(runningTasks.flatMap((t) => t.vehicle_id ? [t.vehicle_id] : []));
    const etas = runningTasks.length > 0
      ? new Map(
        unwrap(await db.from("task_eta").select("task_id, final_eta_at").in("task_id", runningTasks.map((t) => t.id)), "eta")
          .map((e) => [e.task_id, e.final_eta_at]),
      )
      : new Map<string, string | null>();
    // A task with its vehicle chosen on the day (Hotfix 2, J) makes no vehicle busy until it has one.
    const busy: (VehicleBusy & { vehicle_id: string })[] = [
      ...runningTasks.flatMap((t) =>
        t.vehicle_id
          ? [{
            vehicle_id: t.vehicle_id,
            status: t.status,
            start_at: t.start_at,
            end_by: t.end_by,
            final_eta_at: etas.get(t.id) ?? null,
          }]
          : []
      ),
      ...unwrap(booked, "tasks").flatMap((t) =>
        t.vehicle_id ? [{ vehicle_id: t.vehicle_id, status: t.status, start_at: t.start_at, end_by: t.end_by }] : []
      ),
    ];

    const listed = filter === "inactive" ? refs.vehicles.filter((v) => !v.active) : active;
    // Phase 7 (§6, §28): each vehicle's photo and its document files (the current one of each kind), what is missing.
    const [photos, docs] = await Promise.all([vehiclePhotoLinks(db, listed, now), documentsOf(db, listed.map((v) => v.id))]);
    const cards = listed.map((v) => {
      const card = vehicleCard(v, refs, today);
      const files = docs.get(v.id) ?? [];
      const missing = v.active ? requiredKinds(v).filter((k) => !files.some((d) => d.kind === k)) : [];
      const used = km.get(v.id) ?? 0;
      const expiring = Object.values(card.documents).some((d) => d.chip === "orange" || d.chip === "red");
      return {
        ...card,
        km_this_month: used,
        over_allowance: v.monthly_km_allowance && used > v.monthly_km_allowance ? true : undefined,
        status: vehicleStatus(v, onTask),
        ...availabilityOf(v.in_garage, busy.filter((t) => t.vehicle_id === v.id), now),
        held_by: holders.has(v.id) ? refs.emp.get(holders.get(v.id)!.employee_id)?.name : undefined,
        held_since: holders.has(v.id) ? colomboTime(holders.get(v.id)!.from_at) : undefined,
        photo_url: photos.get(v.id)?.photo,
        thumb_url: photos.get(v.id)?.thumb,
        document_files: files.length
          ? files.map((d) => ({ kind: d.kind, name: d.name ?? undefined, expiry: d.expiry ?? undefined, has_file: true }))
          : undefined,
        documents_missing: missing.length ? missing : undefined,
        documents_missing_text: missing.length
          ? `${missing.length} document${missing.length === 1 ? "" : "s"} missing: ${missingText(missing)}`
          : undefined,
        expiring,
      };
    });

    const counts = {
      all: active.length,
      on_task: cards.filter((c) => c.status === "On a task").length,
      available: cards.filter((c) => c.status === "Available").length,
      in_garage: cards.filter((c) => c.status === "In garage").length,
      documents_expiring: cards.filter((c) => c.expiring).length,
    };
    const shown = cards.filter((c) =>
      filter === "on_task"
        ? c.status === "On a task"
        : filter === "available"
        ? c.status === "Available"
        : filter === "in_garage"
        ? c.status === "In garage"
        : filter === "documents_expiring"
        ? c.expiring
        : true
    ).map(({ expiring: _expiring, ...card }) => card);

    return {
      result: { month: today.slice(0, 7), filter, counts: filter === "inactive" ? undefined : counts, vehicles: shown },
      summary: `${shown.length} vehicles (${filter})`,
    };
  },
});

export const registerVehicle = tool({
  name: "register_vehicle",
  title: "Register vehicle",
  description: "Adds a vehicle. Only the plate is required; everything else can be filled in later with update_vehicle.",
  readOnly: false,
  input: z.object(vehicleFields).partial().extend({
    reg_no: zText(20).describe('Number plate, e.g. "WP CAB-4521"'),
  }),
  async run(args, { db, now }) {
    const refs = await loadRefs(db);
    const regNo = normalisePlate(args.reg_no);
    const created = unwrap(
      await db.from("vehicles").insert({ ...toColumns(args, refs), reg_no: regNo }).select("*").single(),
      "vehicle",
    );
    return {
      result: { registered: vehicleCard(created, refs, colomboDate(now)) },
      summary: `registered vehicle ${regNo}`,
    };
  },
});

export const updateVehicle = tool({
  name: "update_vehicle",
  title: "Update vehicle",
  description: "Changes details of a vehicle: rental, km allowance, odometer, service, document dates, garage, active, the custodian " +
    "(the office person who keeps it) and a custody note. Send null to clear a value.",
  readOnly: false,
  input: z.object({
    reg_no: zText(20).describe("Plate of the vehicle to change"),
    ...clearable(vehicleFields),
    new_reg_no: zText(20).optional().describe("Only to correct the plate itself"),
    in_garage: z.boolean().optional().describe("true while the vehicle is in the garage"),
    garage_booked_date: zDate.nullable().optional(),
    active: z.boolean().optional().describe("false when the vehicle has been returned"),
  }),
  async run(args, { db, now }) {
    const refs = await loadRefs(db);
    const vehicle = findVehicle(refs, args.reg_no);
    const { reg_no: _reg, new_reg_no, in_garage, garage_booked_date, active, ...fields } = args;
    if (garage_booked_date) realDate(garage_booked_date, "garage_booked_date");

    const columns: Update<"vehicles"> = {
      ...toColumns(fields, refs),
      ...(new_reg_no !== undefined && { reg_no: normalisePlate(new_reg_no) }),
      ...(in_garage !== undefined && { in_garage }),
      ...(garage_booked_date !== undefined && { garage_booked_date }),
      ...(active !== undefined && { active }),
    };
    const changed = Object.keys(columns);
    if (changed.length === 0) throw new ToolError("Nothing to change: give at least one field.");

    const updated = unwrap(await db.from("vehicles").update(columns).eq("id", vehicle.id).select("*").single(), "vehicle");
    return {
      result: { updated: vehicleCard(updated, refs, colomboDate(now)), changed, in_garage: updated.in_garage },
      summary: `updated ${vehicle.reg_no}: ${changed.join(", ")}`,
    };
  },
});

export const addRentalCompany = tool({
  name: "add_rental_company",
  title: "Add rental company",
  description: "Adds a company that vehicles are rented from.",
  readOnly: false,
  input: z.object({ name: zText(120), phone: zText(30).optional() }),
  async run({ name, phone }, { db }) {
    const created = unwrap(
      await db.from("rental_companies").insert({ name, phone: phone ?? null }).select("*").single(),
      "rental company",
    );
    return { result: { added: { name: created.name, phone: created.phone } }, summary: `added rental company ${created.name}` };
  },
});
