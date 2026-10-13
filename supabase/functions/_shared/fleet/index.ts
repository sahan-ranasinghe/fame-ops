// The Fame Fleet rules and tools, shared by the office connector (office-mcp,
// used from Claude) and the office API (office-api, used by the web app).
// Everything the office can do is a tool in TOOLS; there is nothing else:
// no raw SQL, no deletes.

import type { AnyTool } from "./tool.ts";
import {
  createOfficeKey,
  createOfficeUser,
  listOfficeUsers,
  resetOfficePassword,
  revokeOfficeKey,
  setOfficeUserActive,
  updateOfficeUser,
} from "./tools/accounts.ts";
import { createDriver, listDrivers, resetPin, setDriverActive, updateDriver } from "./tools/drivers.ts";
import { driverRoute, liveDrivers } from "./tools/locations.ts";
import { listVehicleReports, mileageSummary, updateVehicleReport } from "./tools/mileage.ts";
import { fleetOverview } from "./tools/overview.ts";
import { addPlace, listPlaces } from "./tools/places.ts";
import { findProject, importProjects } from "./tools/projects.ts";
import { createRequest, decideRequest, listRequests, suggestVehicles } from "./tools/requests.ts";
import { cancelTask, createTask, reassignTask, taskBoard, taskDetail } from "./tools/tasks.ts";
import { addRentalCompany, listVehicles, registerVehicle, updateVehicle } from "./tools/vehicles.ts";

export const TOOLS: AnyTool[] = [
  fleetOverview,
  liveDrivers,
  driverRoute,
  listDrivers,
  createDriver,
  resetPin,
  setDriverActive,
  updateDriver,
  listVehicles,
  registerVehicle,
  updateVehicle,
  addRentalCompany,
  listPlaces,
  addPlace,
  createTask,
  taskBoard,
  taskDetail,
  cancelTask,
  reassignTask,
  createRequest,
  listRequests,
  suggestVehicles,
  decideRequest,
  mileageSummary,
  listVehicleReports,
  updateVehicleReport,
  importProjects,
  findProject,
  listOfficeUsers,
  createOfficeUser,
  resetOfficePassword,
  setOfficeUserActive,
  createOfficeKey,
  revokeOfficeKey,
  updateOfficeUser,
];

export const INSTRUCTIONS = [
  "Fame Fleet office connector for Fame Global Solutions (Sri Lanka): vehicles, drivers, tasks, vehicle requests, live locations and mileage.",
  "All dates and times are Asia/Colombo (dates YYYY-MM-DD, times 24-hour HH:MM). Money is LKR. Distances are km.",
  "Drivers are identified by username, employee code or name; vehicles by number plate (spaces and dashes do not matter).",
  "create_task, reassign_task and decide_request return warnings. They never block: read them to the user.",
  "Nothing can be deleted. Tasks are cancelled, drivers and vehicles are switched off.",
  "Links: maps = Google Maps, call = tel:, whatsapp = wa.me. Photo links stop working after 1 hour.",
  "Projects come from Zoho Books: read them with the Zoho connector and pass them to import_projects.",
  "Office accounts (users permission): create_office_user returns a one-time set-password link to send by WhatsApp; never ask for or type a password. " +
  "Each office person has permissions (view, request, approve, assign_tasks, vehicles, issues, users); update_office_user changes them.",
].join("\n");

export { adminClient, type Db, ToolError } from "./db.ts";
export {
  allows,
  hasAny,
  normalisePermissions,
  type Permission,
  PERMISSION_TEXT,
  PERMISSIONS,
  permissionsForRole,
  PRESETS,
  roleForPermissions,
  TOOL_PERMISSION,
  toolsFor,
} from "./permissions.ts";
export { type Actor, canCall, type Channel, isRole, mfaRequiredRoles, OFFICE_ROLES, type Role, STRONG_ROLES, TOOL_ROLES } from "./roles.ts";
export { runTool, type ToolOutcome } from "./run.ts";
export type { AnyTool } from "./tool.ts";
