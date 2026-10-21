// Who drives a trip (Round 3, 21 October 2026; docs/phase8-plan.md section 30). The booking forms' "Who's driving?":
// a driver with the app (the default), the person who asked (I'll drive myself), or someone who is not in Fame Fleet
// (a name and a phone). The old path, the vehicle's custodian driving it (driver_required false, Phase 5 Part 6), stays
// for the Teams artifact and becomes a self-driven trip.
//
// A task always sits on a person's account (tasks.employee_id): the driver's, the self-driver's, or for someone else the
// person who asked or booked it (never shown as the driver). Self and someone-else trips have no app: no accept, push or
// reminder (those skip a task whose employee is not a driver), and they need a specific vehicle.

import { z } from "zod";
import { ToolError } from "./db.ts";
import type { Employee, Vehicle } from "./fleet.ts";
import { storedPhone } from "./phones.ts";
import { zText } from "./tool.ts";

export type DrivenBy = "driver" | "self" | "other";
/** What a request asked: one of the three, or the old custodian path. */
export type Asked = DrivenBy | "custodian";

export const SELF_DRIVE_OFF =
  "Self-drive is switched off (Settings → Fleet, self_drive_allowed): every trip needs a driver. Give a driver.";

export const whoDrivesInput = {
  driven_by: z.enum(["driver", "self", "other"]).optional().describe(
    "Who drives: driver (a Fame Fleet driver; the default), self (the person asking drives it themselves), other (someone " +
      "not in Fame Fleet: give driver_name and driver_phone). self and other need the setting self_drive_allowed",
  ),
  driver_name: zText(120).optional().describe("Someone else drives (driven_by other): their name"),
  driver_phone: zText(30).optional().describe("Someone else drives (driven_by other): their phone, a Sri Lankan number"),
};

/** The choice an input makes: driven_by wins; driver_required false alone is the old custodian path. */
export function askedOf(args: { driven_by?: DrivenBy; driver_required?: boolean }, before: Asked = "driver"): Asked {
  if (args.driven_by) return args.driven_by;
  if (args.driver_required === false) return "custodian";
  if (args.driver_required === true) return "driver";
  return before;
}

/**
 * Checks a choice as it is saved on a request or a task, and answers the columns to store. `person` is the employee the
 * trip is for (the asker, or the actor on create_task); null when there is none (the shared connector key).
 */
export function checkAsked(
  asked: Asked,
  details: { driver_name?: string | null; driver_phone?: string | null },
  selfDriveAllowed: boolean,
  person: { employeeId: string | null },
): { driven_by: Asked; driver_required: boolean; driver_name: string | null; driver_phone: string | null } {
  if (asked !== "driver" && !selfDriveAllowed) throw new ToolError(SELF_DRIVE_OFF);
  if (asked === "self" && !person.employeeId) {
    throw new ToolError("\"I'll drive myself\" needs a person's own sign-in (not the shared connector key): give a driver.");
  }
  if (asked === "other") {
    const name = details.driver_name?.trim();
    if (!name) throw new ToolError("Someone else drives: give their name (driver_name) and phone (driver_phone).");
    const phone = storedPhone(details.driver_phone ?? null, "driver_phone");
    if (!phone) throw new ToolError("Someone else drives: give their phone (driver_phone), so the office can call them.");
    if (!person.employeeId) {
      throw new ToolError("Someone else drives: the trip needs a person who books it (not the shared connector key).");
    }
    return { driven_by: asked, driver_required: false, driver_name: name, driver_phone: phone };
  }
  return { driven_by: asked, driver_required: asked === "driver", driver_name: null, driver_phone: null };
}

export interface WhoDrives {
  /** The account the task sits on (the driver, the self-driver, or the person responsible for someone else). */
  employee: Employee;
  drivenBy: DrivenBy;
  driverName: string | null;
  driverPhone: string | null;
}

/**
 * Who drives the task when a request is approved or booked. A driver named by the approver always wins (the task is then
 * a driver's). Otherwise the request's own choice: a driver must then be named; self = the asker; other = the name and
 * phone asked, on the asker's account (else the approver's); custodian = the vehicle's custodian (Phase 5 Part 6). The
 * last three need a specific vehicle.
 */
export function decideWhoDrives(
  input: {
    driverTyped: Employee | null;
    asked: Asked;
    askerId: string | null;
    approverId: string | null;
    driverName: string | null;
    driverPhone: string | null;
    vehicle: Vehicle | null;
    selfDriveAllowed: boolean;
  },
  emp: Map<string, Employee>,
): WhoDrives {
  const { driverTyped, asked, vehicle } = input;
  if (driverTyped) return { employee: driverTyped, drivenBy: "driver", driverName: null, driverPhone: null };
  if (asked === "driver") {
    throw new ToolError("Give a driver (the request asks for one). availability and suggest_vehicles show who is free.");
  }
  if (!input.selfDriveAllowed) throw new ToolError(SELF_DRIVE_OFF);
  const active = (id: string | null) => {
    const e = id ? emp.get(id) : undefined;
    return e?.active ? e : undefined;
  };
  if (asked === "custodian") {
    if (!vehicle) throw new ToolError("The custodian drives their own vehicle: name the vehicle.");
    const custodian = active(vehicle.custodian_employee_id ?? null);
    if (!custodian) throw new ToolError(`${vehicle.reg_no} has no custodian to drive it: give a driver.`);
    // A custodian who is a driver has the app: theirs is a driver's trip (pushes, accept, reminders).
    return { employee: custodian, drivenBy: custodian.role === "driver" ? "driver" : "self", driverName: null, driverPhone: null };
  }
  if (asked === "self") {
    const asker = active(input.askerId);
    if (!asker) throw new ToolError("The person who asked is not an active office user, so they cannot drive it: give a driver.");
    if (!vehicle) throw new ToolError(`${asker.name} drives it: name the vehicle (no app to choose one on the day).`);
    return { employee: asker, drivenBy: "self", driverName: null, driverPhone: null };
  }
  const owner = active(input.askerId) ?? active(input.approverId);
  if (!owner) throw new ToolError("Someone else drives: the trip needs a person who books it (not the shared connector key).");
  if (!input.driverName) throw new ToolError("Someone else drives: the request has no name for them. Give a driver.");
  if (!vehicle) throw new ToolError(`${input.driverName} drives it: name the vehicle (no app to choose one on the day).`);
  return { employee: owner, drivenBy: "other", driverName: input.driverName, driverPhone: input.driverPhone };
}

/** The name shown as the driver: someone else's own name, else the account's. */
export function shownDriver(task: { driven_by?: string | null; driver_name?: string | null }, employee: { name: string } | undefined) {
  return task.driven_by === "other" ? task.driver_name ?? "Someone else" : employee?.name;
}

/** The status line of a trip with no app (Round 3; the app translates both). */
export function noAppLine(drivenBy: string | null | undefined): string | null {
  if (drivenBy === "self") return "Drives themselves · no app";
  if (drivenBy === "other") return "Someone else drives · no app";
  return null;
}

/** The note on a task with no app (the task's notes, as "Driven by the custodian." was). */
export function noAppNote(w: WhoDrives): string | null {
  if (w.drivenBy === "self") return `${w.employee.name} drives it (no app).`;
  if (w.drivenBy === "other") return `${w.driverName} drives it (someone else, no app)${w.driverPhone ? `: ${w.driverPhone}` : ""}.`;
  return null;
}
