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
import { clockOutDriver, dutyLog, moveDriverVehicle, swapReading } from "./tools/duty.ts";
import { driverRoute, liveDrivers, watchDrivers } from "./tools/locations.ts";
import { listFuel } from "./tools/fuel.ts";
import { listVehicleReports, mileageSummary, updateVehicleReport } from "./tools/mileage.ts";
import { fleetOverview } from "./tools/overview.ts";
import {
  addPlace,
  googlePlace,
  importPlaces,
  listImportPresets,
  listPlaceImports,
  listPlaces,
  placeDetail,
  saveArrivalPlace,
  saveImportPreset,
  savePlace,
  searchPlaces,
  undoPlaceImport,
  updatePlace,
} from "./tools/places.ts";
import { registerMapLoad } from "./tools/google.ts";
import { findProject, importProjects } from "./tools/projects.ts";
import { availability } from "./tools/availability.ts";
import {
  bookVehicle,
  cancelRequest,
  createRequest,
  decideRequest,
  listRequests,
  redecideRequest,
  suggestVehicles,
  updateRequest,
} from "./tools/requests.ts";
import { issueHistory, listIssues, updateIssue } from "./tools/issues.ts";
import { myNotificationSettings, registerWebPush, removeWebPush, setMyNotificationSettings } from "./tools/notifications.ts";
import { getSettings, routingUsage, updateSettings } from "./tools/settings.ts";
import {
  cancelTask,
  createTask,
  planTask,
  reassignTask,
  reopenTask,
  taskBoard,
  taskDetail,
  updateTask,
  updateTaskStops,
} from "./tools/tasks.ts";
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
  googlePlace,
  registerMapLoad,
  saveArrivalPlace,
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
  dutyLog,
  clockOutDriver,
  moveDriverVehicle,
  swapReading,
  reopenTask,
];

export const INSTRUCTIONS = [
  "Fame Fleet office connector for Fame Global Solutions (Sri Lanka): vehicles, drivers, tasks, vehicle requests, live locations and mileage.",
  "All dates and times are Asia/Colombo (dates YYYY-MM-DD, times 24-hour HH:MM). Money is LKR. Distances are km.",
  "Drivers are identified by username, employee code or name; vehicles by number plate (spaces and dashes do not matter).",
  "create_task, reassign_task and decide_request return warnings. They never block: read them to the user.",
  "A task has stops (pickup, drop, visit; what: people, goods, documents) with a dwell time and an optional arrive_by deadline. " +
  "The leave-by time is planned from the deadlines (plan_task previews it); update_task_stops changes the stops of a task with its plan_version.",
  "A driver accepts or declines a task in the app. A declined task, or one not accepted within the accept window (accept_within_min " +
  "after sending or accept_before_leave_min before leaving, whichever comes first), needs a driver: task_board's needs_driver list " +
  "and fleet_overview's needs_driver come first, with the best match. reassign_task gives it to another driver or back to the same " +
  "one; cancel_task closes it. task_detail shows the reason and who is free.",
  "Requests and tasks never need a vehicle named: create_task, decide_request and book_vehicle take the driver's vehicle today, else " +
  "their regular one, and say which (vehicle_used, with the reason). Their answers carry the plan as a timeline (leave, each leg, " +
  "each stop with its time at the stop) and conflicts (the vehicle or the driver busy then) with the other task's people to call.",
  "Issues (list_issues): everything that needs attention, opened and auto-resolved by the system (fleet_overview's needs_attention " +
  "is the same list). update_issue takes, notes, resolves or dismisses one; a vehicle problem issue mirrors onto the driver's report.",
  "Notifications (web push in the office web app): my_notification_settings and set_my_notification_settings are a person's own " +
  "(a signed-in person or a personal key; the shared key has no person). Events: a request comes in, your request is decided, a task " +
  "declined or not accepted (also to the person who assigned it and the requester), a driver who needs another vehicle, a critical " +
  "issue, an issue given to you.",
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
  'The Google package (get_settings google): search_places with google offers Google\'s places (credit them "Google Maps"); ' +
  "google_place gives a result's pin (kept 30 days, never saved as one of our places) and a stop takes its google_place_id with the " +
  "name as place. Plans and ETAs then use Google's traffic. Every Google call is counted against a daily and a monthly cap; at a cap " +
  "the open package answers and a note says so. Google's terms: never draw a Google stop (google: true) or Google data on a map that " +
  "is not Google's (list it instead).",
  "Placing a stop: when our places (search_places without google) have no good match, offer to search Google's places " +
  "(search_places with google: true) instead of guessing a place.",
  "A driver's day: the driver clocks in with Start work and today's vehicle and out with Finish work (the server also clocks out at " +
  "the cut-off, duty_cutoff, never while a task runs). One vehicle, one driver: a driver who takes a vehicle takes it from whoever " +
  "held it (they are told). live_drivers shows each driver on a task, on duty or off duty with the vehicle they hold; list_vehicles " +
  "who holds each; duty_log the periods with the vehicles held and the tasks. clock_out_driver (not while a task runs) and " +
  "move_driver_vehicle are the office's. move_driver_vehicle for a driver on a task is a swap (a breakdown): the task goes on in the new vehicle with both " +
  "stretches kept (old_end_km and new_start_km, or the driver enters them on the phone); task km = the stretches added up, each " +
  "vehicle's mileage gets its own; swap_reading types a reading still owed afterwards (a towed vehicle). A driver can ask for another vehicle on a breakdown or accident report: a critical issue. " +
  "A task completed with far fewer km than planned is flagged completed early; reopen_task sets a " +
  "task completed today back to in progress.",
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
export { googleUse } from "./google.ts";
export { loadSettings } from "./settings.ts";
