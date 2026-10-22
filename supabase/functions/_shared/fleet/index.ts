// The Fame Fleet rules and tools, shared by the office connector (office-mcp,
// used from Claude) and the office API (office-api, used by the web app).
// Everything the office can do is a tool in TOOLS; there is nothing else:
// no raw SQL, no deletes.

import type { AnyTool } from "./tool.ts";
import { listTasks, setTripPurpose } from "./tools/history.ts";
import {
  createOfficeKey,
  createOfficeUser,
  listOfficeUsers,
  resetOfficePassword,
  revokeOfficeKey,
  setOfficeUserActive,
  updateMyProfile,
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
  removePlace,
  restorePlace,
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
import { askAnswers, askDrivers } from "./tools/asks.ts";
import { driversBoard } from "./tools/board.ts";
import { driverProfile, setDriverLicencePhoto } from "./tools/profile.ts";
import { removeUnavailability, setUnavailability, unavailability } from "./tools/unavailability.ts";
import {
  bookVehicle,
  cancelRequest,
  createRequest,
  decideRequest,
  listRequests,
  myTrips,
  redecideRequest,
  reviewing,
  suggestVehicles,
  updateRequest,
} from "./tools/requests.ts";
import { issueHistory, listIssues, updateIssue } from "./tools/issues.ts";
import {
  markInboxRead,
  myInbox,
  myNotificationSettings,
  myPrefs,
  registerWebPush,
  removeWebPush,
  setMyNotificationSettings,
  setMyPrefs,
} from "./tools/notifications.ts";
import { getSettings, routingUsage, updateSettings } from "./tools/settings.ts";
import { listAppErrors } from "./tools/appErrors.ts";
import { activityLog, setActivityTools } from "./tools/activity.ts";
import { finishMyTrip, myTrip, myTripCheck, vehicleChecks } from "./tools/checks.ts";
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
import {
  photoUploadUrl,
  removeVehicleDocument,
  restoreVehicleDocument,
  saveVehicleDocument,
  setDriverPhoto,
  setVehiclePhoto,
  vehicleDocuments,
  vehicleDocumentUploadUrl,
} from "./tools/media.ts";

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
  listAppErrors,
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
  // Phase 7, Part 3 (§5, §6, §28): photos and documents.
  photoUploadUrl,
  setDriverPhoto,
  setVehiclePhoto,
  vehicleDocumentUploadUrl,
  saveVehicleDocument,
  vehicleDocuments,
  removeVehicleDocument,
  restoreVehicleDocument,
  // Phase 7 (§15): remove and restore a place.
  removePlace,
  restorePlace,
  listTasks,
  setTripPurpose,
  // Hotfix 2: My trips, the notification centre, my phone number, who is reviewing a request.
  myTrips,
  myInbox,
  markInboxRead,
  updateMyProfile,
  reviewing,
  // Hotfix 3: the person's page preferences.
  myPrefs,
  setMyPrefs,
  // Part 3b: the driver's profile, availability, the Drivers board, asking drivers.
  driverProfile,
  setDriverLicencePhoto,
  unavailability,
  setUnavailability,
  removeUnavailability,
  driversBoard,
  askDrivers,
  askAnswers,
  // Round 2b: who changed what and when (users).
  activityLog,
  // Round 4–7 (4): the vehicle check before work; a no-app trip's own check and close.
  vehicleChecks,
  myTrip,
  myTripCheck,
  finishMyTrip,
];
// Round 2b: the Activity log reads every tool's title and whether it writes (this list, read when it runs).
setActivityTools(() => TOOLS);

export { WEB_ONLY_TOOLS } from "./tools/media.ts";

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
  "issue, an issue given to you. Everyone told has it in their notification centre too (my_inbox, mark_inbox_read), with or " +
  "without a browser; my_trips lists a person's own requests and proposed tasks with each trip's live state.",
  "Several people may approve: decide_request takes the version list_requests showed and refuses a request someone else decided " +
  'since ("Already approved by Palitha at 10:42"); request cards name who approved, declined or cancelled. Phone numbers are ' +
  "stored +94… (update_my_profile for your own, update_office_user and update_driver for others); a task may have its vehicle " +
  'chosen on the day (vehicle "on the day" or "any van", when the setting vehicle_on_the_day is on).',
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
  "Tasks go to the fleet admin first (get_settings tasks_need_approval, on by default): create_task by someone without the approve " +
  "permission answers waiting_for_approval and the task waits in the requests queue (list_requests kind task, task_board " +
  "waiting_approval) until decide_request sends it as proposed or changed. A request can carry its whole trip (create_request with " +
  "stops, as create_task takes them); approving copies its stops into the task. A waiting one is pushed to the approvers 30 minutes " +
  "before it leaves and when its leave-by passes; it is never sent by itself.",
  "Photos and documents: drivers and vehicles may have photos (photo_url, thumb_url), and vehicles their documents " +
  "(vehicle_documents: revenue licence, insurance, emission test, CR, the rent or lease agreement, others; missing ones are listed). " +
  "Files are added in the web app only.",
  "Nothing is deleted: tasks are cancelled, drivers and vehicles switched off, places removed and restored (remove_place " +
  "answers needs_confirm for the base place or a place that tasks today or later use; list_places removed lists them).",
  "Links: maps = Google Maps, call = tel:, whatsapp = wa.me. Photo links stop working after 1 hour.",
  "Drivers can start a trip themselves in the app (kind self; purpose company or personal, the setting driver_personal_trips): " +
  "task_board and task_detail show kind and purpose; set_trip_purpose switches one or attaches a project; mileage_summary counts personal km apart. " +
  "list_tasks is the task history over a range of days; mileage_summary, list_fuel and list_issues also take from and to (YYYY-MM-DD).",
  "Vehicle checks (Round 4–7; get_settings vehicle_check): whenever a driver takes a vehicle, and before a trip someone drives " +
  'themselves or that is booked for someone else, the person answers "Any damage or problem with <plate>?": all good, or a ' +
  "problem (breakdown, accident, tyre, warning_light, damage, other) with photos, which becomes a pre-trip vehicle report " +
  "and issue. vehicle_checks lists them; list_vehicles carries each vehicle's check_today. A trip nobody drives with the app " +
  "(driven_by self or other) is checked, started and finished by its own person in the office app (my_trip, my_trip_check, " +
  'finish_my_trip: "Trip finished? Enter the odometer"); unanswered by 09:00 the next day it closes as Completed · not ' +
  "confirmed (an issue), and the odometer entered later still confirms it.",
  "Fuel (Round 4–7; get_settings fuel_card): vehicles have a fuel_type (petrol, diesel, hybrid, electric) and an optional " +
  "fuel_grade (petrol_92, petrol_95, auto_diesel, super_diesel); give them with register_vehicle / update_vehicle (an older " +
  'vehicle says "Fuel type: not set"). At Start task the driver sees the trip\'s km and roughly how many litres it takes (km ' +
  'per litre from the vehicle\'s last 3 fills, else a default by type) and answers "Enough fuel?"; task_detail fuel_card ' +
  "shows the estimate and the answer. Never blocks.",
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
export { phoneDisplay } from "./format.ts";
