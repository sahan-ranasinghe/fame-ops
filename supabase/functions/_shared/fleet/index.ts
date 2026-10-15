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
import { driverRoute, liveDrivers, watchDrivers } from "./tools/locations.ts";
import { listFuel } from "./tools/fuel.ts";
import { listVehicleReports, mileageSummary, updateVehicleReport } from "./tools/mileage.ts";
import { fleetOverview } from "./tools/overview.ts";
import { addPlace, importPlaces, listImportPresets, listPlaceImports, listPlaces, placeDetail, saveImportPreset, savePlace, searchPlaces, undoPlaceImport, updatePlace } from "./tools/places.ts";
import { findProject, importProjects } from "./tools/projects.ts";
import { availability } from "./tools/availability.ts";
import { bookVehicle, cancelRequest, createRequest, decideRequest, listRequests, redecideRequest, suggestVehicles, updateRequest } from "./tools/requests.ts";
import { issueHistory, listIssues, updateIssue } from "./tools/issues.ts";
import { myNotificationSettings, registerWebPush, removeWebPush, setMyNotificationSettings } from "./tools/notifications.ts";
import { getSettings, routingUsage, updateSettings } from "./tools/settings.ts";
import { cancelTask, createTask, planTask, reassignTask, taskBoard, taskDetail, updateTask, updateTaskStops } from "./tools/tasks.ts";
import { addRentalCompany, listVehicles, registerVehicle, updateVehicle } from "./tools/vehicles.ts";

export const TOOLS: AnyTool[] = [
  fleetOverview,
  liveDrivers,
  driverRoute,
  watchDrivers,
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
  searchPlaces,
  savePlace,
  placeDetail,
  importPlaces,
  updatePlace,
  listImportPresets,
  saveImportPreset,
  listPlaceImports,
  undoPlaceImport,
  createTask,
  taskBoard,
  taskDetail,
  cancelTask,
  reassignTask,
  createRequest,
  listRequests,
  suggestVehicles,
  decideRequest,
  bookVehicle,
  cancelRequest,
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
  planTask,
  updateTaskStops,
  getSettings,
  updateSettings,
  routingUsage,
  listIssues,
  updateIssue,
  issueHistory,
  myNotificationSettings,
  setMyNotificationSettings,
  registerWebPush,
  removeWebPush,
  availability,
  updateRequest,
  redecideRequest,
  updateTask,
  listFuel,
];

export const INSTRUCTIONS = [
  "Fame Fleet office connector for Fame Global Solutions (Sri Lanka): vehicles, drivers, tasks, vehicle requests, live locations and mileage.",
  "All dates and times are Asia/Colombo (dates YYYY-MM-DD, times 24-hour HH:MM). Money is LKR. Distances are km.",
  "Drivers are identified by username, employee code or name; vehicles by number plate (spaces and dashes do not matter).",
  "create_task, reassign_task and decide_request return warnings. They never block: read them to the user.",
  "A task has stops (pickup, drop, visit; what: people, goods, documents) with a dwell time and an optional arrive_by deadline. " +
  "The leave-by time is planned from the deadlines (plan_task previews it); update_task_stops changes the stops of a task with its plan_version.",
  "A driver accepts or declines a task in the app. A declined task waits in task_board's declined column (needs a driver): " +
  "reassign_task gives it to another driver or back to the same one; cancel_task closes it. task_detail shows the reason and who is free.",
  "Issues (list_issues): everything that needs attention, opened and auto-resolved by the system (fleet_overview's needs_attention " +
  "is the same list). update_issue takes, notes, resolves or dismisses one; a vehicle problem issue mirrors onto the driver's report.",
  "Notifications (web push in the office web app): my_notification_settings and set_my_notification_settings are a person's own " +
  "(a signed-in person or a personal key; the shared key has no person). Events: a request comes in, your request is decided, a task " +
  "declined or not accepted, a critical issue, an issue given to you.",
  "A vehicle can have a custodian (update_vehicle custodian): list_vehicles shows who it is assigned to and whether it is free, on a " +
  "task or booked; suggest_vehicles groups the free pool, the assigned ones (ask the custodian first), the busy and the in-garage ones. " +
  "book_vehicle makes a request and its task in one go (the custodian drives when driver_required is false); cancel_request cancels " +
  "a booking and its task.",
  "The person who asked may change their request (update_request, with its version): a waiting one stays waiting; an approved " +
  "booking becomes changed and the approver decides it again (redecide_request: keep, change the vehicle, driver or time, or " +
  "decline). update_task changes a task's time, driver, vehicle, title, passengers, contact or notes with plan_version; the driver " +
  "hears what changed. availability(at, until) says who is on duty, off duty or on a task, and which vehicles are free.",
  "Every fuel fill has a silent video from the driver's phone (list_fuel: the month's entries with 1-hour video links; task_detail " +
  "shows a task's fills, each with marks: the steps the driver ticked and the second of each). Videos are kept 12 months (fuel_video_keep_months). " +
  "The steps the driver shows in order while recording are the setting fuel_video_checklist (plate, zero, pumping, final by default).",
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
