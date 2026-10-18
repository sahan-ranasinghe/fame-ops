// The JSON the tools answer (the contract in scripts/tool-shapes.json). Only
// the fields the screens read are typed; everything is optional where the
// tool leaves it out.

export interface Links {
  maps?: string;
  whatsapp?: string;
  call?: string;
}

export type DriverStatus = "live" | "location_off" | "no_signal" | "not_sharing";

/** The raw times behind a status (ISO), so a screen can recompute it as the clock ticks or a Realtime row arrives. */
export interface Signal {
  sharing: boolean;
  point_at: string | null;
  heartbeat_at: string | null;
  location_on: boolean | null;
  permission: string | null;
  location_off_since: string | null;
  /** Points the server refused and the phone keeps ("N points refused" on the status line). */
  rejected_points?: number | null;
}

/** The status fields every driver card carries (live_drivers, fleet_overview). */
export interface StatusFields {
  status?: DriverStatus;
  status_text?: string;
  status_since?: string;
  last_position_at?: string;
  /** "HH:MM:SS" of the newest GPS point: "position HH:MM:SS" beside the marker and on the live card. */
  last_position_time?: string;
  heartbeat_at?: string;
  location_on?: boolean;
  permission?: string;
  app_version?: string;
  queued_points?: number;
  rejected_points?: number;
  data_available?: boolean;
  app_state?: string;
  signal?: Signal;
}

export interface RoadDriver extends StatusFields {
  driver: string;
  username?: string;
  vehicle?: string;
  task?: string;
  going_to?: string;
  near?: string;
  location?: string;
  links?: Links;
}

export interface Attention {
  what: string;
  subject?: string;
  /** Phase 7 (§16): the plate of the vehicle it is about. */
  vehicle?: string;
  due?: string;
  level?: string;
  /** Phase 5: the issue behind the item (opens /issues/:id). */
  issue_id?: string;
  kind?: string;
  severity?: string;
}

/**
 * Hotfix 3 (L3): a page of a list (asked with `limit`, and `cursor` for a later page, @fleet/paging). `total` = every row
 * the filters match; `next` = the cursor of the next page (absent on the last). Absent when no limit was asked.
 */
export interface Paged {
  total?: number;
  next?: string;
}

/** Hotfix 3 (L2): one row of Needs attention: one issue, or a group of one kind ("Odometer typed by hand · 9 this week"). */
export interface AttentionGroup {
  /** "kind" or "kind:vehicle": stable, for the expanded state. */
  key: string;
  kind: string;
  /** "Odometer typed by hand · 9 this week", "Documents missing on 3 vehicles"; one item: its own words. */
  title: string;
  count: number;
  severity: "critical" | "warning";
  /** The issues behind it (Snooze and Dismiss act on all of them). */
  issue_ids: string[];
  /** The items, most urgent first (all of them: the group expands in place). */
  items: Attention[];
  vehicle?: string;
}

export interface Overview {
  date: string;
  as_of?: string;
  vehicles: { on_the_road: number; total: number; parked: number; in_garage?: number };
  tasks: { total: number; in_progress: number; done: number; assigned?: number; cancelled?: number };
  requests: { waiting: number; oldest_waiting?: string };
  reminders: { count: number; red?: number; window_days?: number };
  on_the_road: RoadDriver[];
  needs_attention: Attention[];
  /** Phase 7 (§19): tasks that need a driver (approve or assign_tasks), first on the page. */
  needs_driver?: { count: number; tasks: NeedsDriverTask[] };
  /**
   * Hotfix 3 (L1, L2): the Overview's Needs attention: critical and warning only, nothing another section shows
   * (requests waiting, needs a driver, the critical issues), snoozed ones left out, items of one kind grouped.
   * `count` = the issues behind the groups. needs_attention stays as it was for the connector.
   */
  attention?: { count: number; groups: AttentionGroup[] };
  /** Hotfix 3 (L1): the critical active issues not snoozed (at most 5) and how many there are. */
  critical?: { count: number; items: Attention[] };
}

/** A task declined, or not accepted within the accept window (Phase 7, §19): it needs a driver now. */
export interface NeedsDriverTask {
  task_id: string;
  /** "09:00" today, else "Fri 17 Oct 09:00". */
  start: string;
  title: string;
  driver: string;
  kind: "declined" | "not_accepted";
  reason_text: string;
  note?: string;
  /** "Kamal declined · Vehicle problem" or "Kamal hasn't accepted · needs a driver". */
  line: string;
  since?: string;
  minutes_to_start: number;
  /** "in 40 min" or "5 min late". */
  when: string;
  /** The best free driver for it, with the vehicle they would take. */
  best?: BestMatch;
}

/** The best match (Phase 7, §3): on duty and free, nearest to the first stop, then the fewest tasks today. */
export interface BestMatch {
  name: string;
  username?: string | null;
  vehicle?: { reg_no: string; source: "on_duty" | "regular" };
  /** "On duty · free 08:00–12:00 · 3.2 km from the pickup · 1 task today" */
  why: string;
}

/** Phase 7 (§13): dispatch = the office's task; self = a trip the driver started in the app. */
export type TaskKind = "dispatch" | "self";
export type TripPurpose = "company" | "personal";

export interface BoardCard {
  id: string;
  time: string;
  started_on?: string;
  label?: string;
  title: string;
  kind?: TaskKind;
  purpose?: TripPurpose;
  /** Hotfix 2 (J): "Vehicle: on the day" or "Any van" while no vehicle is set (vehicle is then absent). */
  vehicle_text?: string;
  /** Hotfix 2 (K): who sent it to the driver. */
  approved_by?: PersonAt;
  from?: string;
  to?: string;
  stops_count?: number;
  leave_by?: string;
  accepted?: string;
  driver?: string;
  vehicle?: string;
  status?: string;
  eta_next?: string;
  eta_final?: string;
  late_min?: number;
  /** Phase 7: completed early (the odometer or the time far under the plan). */
  finish_flag?: FinishFlag;
  /** Phase 7 (§5, §6): the driver's photo and the vehicle's thumbnail (links that work for at least an hour). */
  driver_photo_url?: string;
  vehicle_thumb_url?: string;
}

/** Phase 7 (item 18): set at completion when the odometer km or the time is far under the plan. */
export interface FinishFlag {
  kind: "completed_early" | string;
  text: string;
}

export interface Board {
  date: string;
  /**
   * Hotfix 3 (L3): asked with `limit`, each column holds at most that many; `totals` = every card of the column, `next`
   * = the cursor for its next page (task_board(date, column, limit, cursor) answers that column only).
   */
  totals?: { assigned?: number; in_progress?: number; completed?: number; declined?: number };
  next?: { assigned?: string; in_progress?: string; completed?: string; declined?: string };
  counts: { assigned: number; in_progress: number; completed: number; cancelled: number; declined?: number; waiting_approval?: number };
  assigned: BoardCard[];
  in_progress: BoardCard[];
  completed: BoardCard[];
  /** Needs a driver (Phase 5): declined by the driver, not yet reassigned. */
  declined?: BoardCard[];
  /** Phase 7 (§19): every task that needs a driver, today and later (declined or not accepted in time). */
  needs_driver?: NeedsDriverTask[];
  /** Phase 7 (§33): tasks proposed for the day that wait for an approver (no task exists yet). */
  waiting_approval?: WaitingApprovalCard[];
}

/** A task proposed for the day, waiting for an approver (task_board.waiting_approval). */
export interface WaitingApprovalCard {
  request_id: string;
  time: string;
  leave_by: string;
  title: string;
  label?: string;
  from?: string;
  to?: string;
  stops_count: number;
  driver?: string;
  vehicle?: string;
  /** Hotfix 2 (J): "Vehicle: on the day" or "Any van" when the proposal names no vehicle. */
  vehicle_text?: string;
  proposed_by: string;
  /** "Waiting for approval · proposed by Nimal" or "Leave-by passed · not decided". */
  status: string;
  late?: boolean;
}

export interface AssignmentEvent {
  at: string;
  action: string;
  driver?: string;
  vehicle?: string;
  actor?: string;
  note?: string;
  /** What a change altered, by label: { time: { from, to }, vehicle: { from, to } } (Phase 6). */
  changes?: FieldChanges;
}

/** A diff in the office's words: { time: { from: "09:00", to: "09:30" } }. */
export type FieldChanges = Record<string, { from?: string | null; to?: string | null }>;
/** Who is free at a task's time (task_detail.suggestions for a declined task). */
export interface FreeAt {
  drivers: { name: string; username?: string | null; availability: string }[];
  vehicles: { reg_no: string; make_model?: string | null; type: string; seats?: number | null; availability: string }[];
}

export interface Stop {
  /** task_detail's stops carry their id (Part 5b: save_arrival_place). */
  id?: string;
  place_id?: string;
  seq: number;
  type: string;
  what?: string;
  place?: string;
  address?: string;
  note?: string;
  dwell_min?: number;
  arrive_by?: string;
  planned_arrive?: string;
  planned_depart?: string;
  lat?: number;
  lng?: number;
  pin?: string;
  status: string;
  arrived?: string;
  /** The driver's phone was within 150 m (the arrival nudge), "HH:MM"; beside the driver's own tap. */
  auto_detected?: string;
  /** A Google place (Part 5): its pin is drawn on Google's map only; the id is kept, the details 30 days. */
  google?: boolean;
  google_place_id?: string;
  /** Part 5b: where the driver's phone was when the stop was reached (ours, kept for good). */
  arrival?: { at?: string; lat: number; lng: number; accuracy_m?: number; near?: string; maps?: string };
  /** Part 5b: the office saved this reached Google stop as one of our places. */
  saved_place?: { id: string; name: string };
  done?: string;
  skip_reason?: string;
  skip_note?: string;
  navigate?: string;
  /** Phase 7 (item 18): how Arrived was marked when not within 300 m: override, no_gps, no_pin, not_arrived; the words and the distance. */
  arrival_flag?: "override" | "no_gps" | "no_pin" | "not_arrived" | string;
  arrival_text?: string;
  arrival_distance_m?: number;
  /** Phase 7 (§11): the stop's place in the order (removed stops not counted) and "Stop 2 · Drop · Kurunegala site". */
  n?: number;
  label?: string;
  /** The start, ticked "Passengers get in here": Stop 1, a pickup with no leg to it. */
  is_start?: boolean;
  /** Phase 7 (§17): where the time at the stop came from: chosen, the place's usual time, or the default. */
  dwell_source?: DwellSource;
  planned_leave?: string;
  /** task_detail: the time at the stop planned and as it happened (Arrived → Done). */
  planned_stay?: { arrive: string; leave: string; minutes: number };
  actual_stay?: { arrived: string; done?: string; minutes?: number };
}

export type DwellSource = "chosen" | "place" | "default";

/** The plan as a timeline (Phase 7, §17): leave, then each leg and stop in order, then the drive back. */
export type TimelineItem =
  | { kind: "leave"; at: string; source: string }
  | {
    kind: "stop";
    n: number;
    label: string;
    place: string;
    planned_arrive: string;
    planned_leave: string;
    arrive_by?: string;
    late_min?: number;
    dwell_min: number;
    dwell_source?: DwellSource;
    is_start?: boolean;
  }
  | {
    kind: "leg";
    from_n: number | "start";
    to_n: number | "base";
    km: number;
    minutes: number;
    source: string;
    rush_factor?: number;
    via_expressway?: boolean;
    /** Phase 7 (§20): Google's road line (encoded polyline), only with with_line; drawn on Google's map only. */
    line?: string;
  };

export interface PlanTimeline {
  items: TimelineItem[];
  totals: { drive_min: number; km: number; ends: string };
}

/** Someone behind an overlapping task, with the links to reach them. */
export interface ConflictPerson {
  name: string;
  phone?: string;
  call?: string;
  whatsapp?: string;
}

/** An overlap as a card (Phase 7, §17): the vehicle or the driver busy then, or the vehicle in the garage. */
export interface Conflict {
  kind: "vehicle" | "driver" | "garage";
  text: string;
  task?: { id: string; title: string; window: string };
  requester?: ConflictPerson;
  driver?: ConflictPerson;
}

/** The vehicle a task took when none was named (Phase 7, §3): the driver's vehicle today, else their regular one. */
export interface VehicleUsed {
  reg_no: string;
  /** "Kamal's vehicle today", "Kamal's regular vehicle", or "chosen". */
  why: string;
}

/** One vehicle's stretch of a task when the office swapped the vehicle during it (Phase 7, §2 addition). */
export interface TaskSegment {
  vehicle?: string;
  from: string;
  to?: string;
  start_km?: number;
  end_km?: number;
  km?: number;
  /** A reading still to come from the driver's phone. */
  readings_waiting?: boolean;
  reason?: string;
  by?: string;
}

export interface PlanLeg {
  from: string;
  to: string;
  depart?: string;
  arrive?: string;
  km: number;
  minutes: number;
  source: string;
  via_expressway?: boolean;
  factor?: number;
}

/** The plan as the tools answer it (create_task, plan_task, task_detail). */
export interface PlanSummary {
  source: string;
  source_label?: string;
  computed_at?: string;
  leave_by?: string;
  leave_by_source?: string;
  ends_at?: string;
  total_drive_min: number;
  total_km: number;
  buffer_min?: number;
  legs: PlanLeg[];
  warnings: string[];
}

export interface PlannedStop {
  seq: number;
  /** Phase 7 (§20): the stop's pin for the plan map; `google`: a Google place (drawn on Google's map only). */
  lat?: number;
  lng?: number;
  google?: boolean;
  /** Phase 7 (§11, §17): the stop's place in the order, its label, the start stop, the time at the stop's source. */
  n?: number;
  label?: string;
  is_start?: boolean;
  dwell_source?: DwellSource;
  planned_leave?: string;
  type: string;
  what?: string;
  place?: string;
  arrive_by?: string;
  planned_arrive?: string;
  planned_depart?: string;
  dwell_min?: number;
  /** The stop's line for the driver (the tools send it with every stop). */
  note?: string;
  pin?: string;
}

export interface PlanPreview {
  date: string;
  leave_by: string;
  leave_by_at?: string;
  leave_by_source: string;
  /** Phase 7 (§20): the start's pin for the plan map (a Google start's is Google's: `google`). */
  start?: { name: string; has_pin: boolean; lat?: number; lng?: number; google?: boolean };
  stops: PlannedStop[];
  plan?: PlanSummary;
  warnings: string[];
  /** Phase 7 (§17). */
  timeline?: PlanTimeline;
  conflicts?: Conflict[];
  vehicle_used?: VehicleUsed;
}

export interface TaskEta {
  next_stop?: string;
  next?: string;
  final?: string;
  late_min?: number;
  source?: string;
  as_of?: string;
}

export interface ProjectShare {
  project: string;
  job_no?: string;
  customer?: string;
  percent: number;
}

export interface OdometerRead {
  kind: string;
  reading_km: number;
  entry?: string;
  photo_reading?: number | null;
  photo_status?: string | null;
  photo_attempts?: number;
  camera_read?: number | null;
  flag?: string | null;
  check?: string;
  at: string;
  photo?: string;
}

export interface FuelRead {
  id?: string;
  litres: number | null;
  amount_lkr: number;
  odometer_km?: number | null;
  at: string;
  receipt_photo?: string;
  /** The video of the fill (Phase 6, Part 3). */
  video?: VideoCard;
}

export type VideoStatus = "none" | "recorded" | "uploading" | "uploaded" | "failed" | "pruned";

export interface VideoCard {
  status: VideoStatus;
  /** The whole fill. */
  duration_s?: number;
  bytes?: number;
  /** A 1-hour signed link to the first piece, only while the file is there. */
  url?: string;
  /** Every piece in order with its link (one for an uninterrupted recording). */
  segments?: { url?: string; duration_s?: number; bytes?: number }[];
  /** The recording was interrupted and continued: expect a break between the pieces. */
  interrupted?: boolean;
  /** The keys of the steps ticked, in order. */
  checklist?: string[];
  /** The steps with the second of each: bookmarks into the video (rows written since the steps became a sequence). */
  marks?: VideoMark[];
  /** "Plate 0:04 · Zero 0:11 · Pumping 0:15 · Final 3:52" */
  timeline?: string;
  uploaded_at?: string;
  note?: string;
}

export interface VideoMark {
  key: string;
  label: string;
  at_s: number;
  clock: string;
}

/** list_fuel: the month's fills with their receipts and videos. */
export interface FuelEntry {
  id: string;
  at: string;
  vehicle?: string;
  driver?: string;
  driver_username?: string;
  task_id?: string;
  litres: number | null;
  lkr: number | null;
  odometer_km?: number | null;
  receipt?: string;
  video: VideoCard;
}

export interface FuelList extends Paged {
  month: string;
  /** Phase 7 (§8): a range of days (list_fuel from/to); the entries and totals are those days', month_totals the month of to. */
  from?: string;
  to?: string;
  month_totals?: { entries: number; litres: number; lkr: number };
  vehicle?: string;
  driver?: string;
  totals: { entries: number; litres: number; lkr: number; videos: number; videos_waiting: number; videos_missing: number; bytes: number; interrupted?: number };
  entries: FuelEntry[];
  links?: string;
}

export interface ReportRead {
  id: string;
  category: string;
  note?: string;
  status: string;
  at: string;
  photos?: string[];
}

export interface TaskDetail {
  task: {
    id: string;
    title: string;
    /** Hotfix 2 (J): specific, or chosen on the day (driver_day) or any vehicle of a type; vehicle_text "Vehicle: on the day". */
    vehicle_mode?: "specific" | "driver_day" | "any_type";
    vehicle_type_wanted?: string;
    vehicle_text?: string;
    /** Hotfix 2 (K): who sent it to the driver, and when. */
    approved_by?: PersonAt;
    /** Hotfix 2 (F): the driver's number for people who may see it (Call driver, WhatsApp driver). */
    driver_phone?: PhoneLinks;
    label?: string;
    kind?: TaskKind;
    purpose?: TripPurpose;
    status: "assigned" | "in_progress" | "completed" | "cancelled" | "declined" | string;
    status_line?: string;
    start: string;
    /** The day and clock as the edit form needs them (Phase 6). */
    date?: string;
    time?: string;
    end_by?: string;
    driver?: string;
    vehicle?: string;
    /** Phase 7 (§5, §6). */
    driver_photo_url?: string;
    vehicle_photo_url?: string;
    vehicle_thumb_url?: string;
    passengers?: number | null;
    contact?: { name?: string | null; phone?: string | null; call?: string; whatsapp?: string };
    notes?: string | null;
    created_by?: string | null;
    sent?: string;
    seen?: string;
    accepted?: string;
    declined?: { at?: string; reason?: string; reason_text?: string; note?: string; after_accept?: boolean };
    started?: string;
    completed?: string;
    cancelled_reason?: string | null;
    start_odometer_km?: number | null;
    end_odometer_km?: number | null;
    km?: number | null;
    gps_km?: number;
    gps_km_note?: string;
    leave_by?: string;
    leave_by_source?: string;
    buffer_min?: number;
    start_place?: string;
    /** Phase 7: the start as the stops form sends it back (a Google start by its id; its pin is Google's). */
    start_place_id?: string;
    start_google_place_id?: string;
    start_lat?: number;
    start_lng?: number;
    return_to_base?: boolean;
    avoid_expressway?: boolean;
    plan_version?: number;
    eta?: TaskEta;
    /** Phase 7: completed early, the reopen (reopen_task: completed today), and a vehicle taken at Start task. */
    finish_flag?: FinishFlag;
    can_reopen?: boolean;
    /** "WP CAB-4521 taken over from Nuwan 08:40" */
    vehicle_taken?: string;
    /** Phase 7: "Vehicle changed by Palitha: WP CAB-4521 instead of Kamal's regular vehicle WP KL-1234". */
    vehicle_changed?: string;
    /** The warnings the person saved past ("… (saved by Palitha)"). */
    warnings_saved?: string[];
    /** Declined, or not accepted within the accept window (§19). */
    needs_driver?: { since: string; reason?: "declined" | "not_accepted" | string; reason_text?: string };
  };
  plan?: PlanSummary;
  /** Phase 7 (§17): the plan as a timeline. */
  timeline?: PlanTimeline;
  /** Phase 7: a vehicle swap during the task keeps each vehicle's stretch; task km = their sum. */
  segments?: TaskSegment[];
  stops: Stop[];
  removed_stops?: { seq: number; place: string; removed?: string }[];
  projects: string | ProjectShare[];
  odometer: OdometerRead[];
  unlogged_km?: { km: number; last_logged_km: number; last_logged_at: string; start_km: number };
  fuel: FuelRead[];
  vehicle_reports: ReportRead[];
  from_request?: { id: string; requested_by: string; project?: string; asked: string };
  driver_links?: Links;
  photo_links?: string;
  assignment_history?: AssignmentEvent[];
  /** Who is free at the task's time; only for a declined task. */
  suggestions?: FreeAt;
}

export interface RequestTimeline {
  sent?: string;
  seen?: string;
  decided?: string;
  decided_by?: string;
  changed?: string;
  cancelled?: string;
}

/** One row of a request's timeline (request_events). */
export interface RequestEvent {
  at: string;
  action: "created" | "seen" | "edited" | "approved" | "declined" | "changed" | "redecided" | "postponed" | "cancelled" | string;
  actor?: string;
  note?: string;
  changes?: FieldChanges;
}

/** The request's fields as the edit form needs them. */
export interface RequestEditFields {
  date: string;
  time: string;
  back_by?: string;
  route_from?: string;
  route_to?: string;
  need_type?: string;
  pax?: number;
  tools?: boolean;
  note?: string;
  driver_required?: boolean;
  on_behalf_of?: string;
  /** Phase 7 (§17): minutes at the From and To places (empty = the place's usual time, else the default). */
  from_dwell_min?: number;
  to_dwell_min?: number;
  /** Phase 7 (§34): a request planned with its trip, as the edit form takes it back (update_request's stops and start). */
  stops?: TripStopInput[];
  start?: TripStartInput;
  /** The leave time typed by hand; absent = planned from the stops' arrive_by times. */
  leave_by?: string;
  return_to_base?: boolean;
  avoid_expressway?: boolean;
}

/** A trip stop as create_request / update_request / create_task take it (Phase 7, §34). */
export interface TripStopInput {
  type: "pickup" | "drop" | "visit";
  what?: "people" | "goods" | "documents" | "other";
  place?: string;
  place_id?: string;
  google_place_id?: string;
  address?: string;
  lat?: number;
  lng?: number;
  dwell_min?: number;
  /** HH:MM on the trip's day. */
  arrive_by?: string;
  note?: string;
}

export interface TripStartInput {
  place?: string;
  place_id?: string;
  google_place_id?: string;
  lat?: number;
  lng?: number;
  /** "Passengers get in here": the start is Stop 1, a pickup. */
  passengers?: boolean;
  what?: "people" | "goods" | "documents" | "other";
  note?: string;
  dwell_min?: number;
}

/** A request's trip as list_requests shows it (Phase 7, §34): the start, the stops with their planned times, the timeline. */
export interface RequestTrip {
  start?: { name: string; has_pin: boolean; lat?: number; lng?: number; google?: boolean };
  leave_by?: string;
  leave_by_source?: string;
  return_to_base?: boolean;
  avoid_expressway?: boolean;
  /** As plan_task's stops; `google` = the stop is on a Google pin (drawn on Google's map only); `status` once a task. */
  stops: (PlannedStop & { google?: boolean; status?: string })[];
  timeline?: PlanTimeline;
  /** "task" once approved: the task's stops and times as they are now (never the plan as first asked). */
  source?: "task";
  /** What the office changed against the request: "Changed by the office · was 09:00 Sat 17 Oct · stops changed". */
  changed?: { by: string; was?: string; stops?: boolean; text: string };
}

/** A task proposed by someone without the approve permission (Phase 7, §33): what they proposed and saw. */
export interface RequestProposal {
  driver?: string;
  username?: string;
  vehicle?: string;
  /** Hotfix 2 (J): "Vehicle: on the day" or "Any van" when the proposal names no vehicle. */
  vehicle_text?: string;
  vehicle_why?: string;
  warnings?: string[];
  conflicts?: Conflict[];
  passengers?: number;
  contact_name?: string;
  contact_phone?: string;
  notes?: string;
}

export interface RequestCard {
  id: string;
  /** Phase 7 (§33): "task" = a task proposed by someone without approve; "request" = a vehicle request. */
  kind?: "request" | "task";
  /** A proposed task's title. */
  title?: string;
  requested_by: string;
  project?: string;
  when: string;
  back_by?: string;
  route?: string;
  need?: string;
  status: "waiting" | "approved" | "changed" | "declined" | "cancelled";
  asked?: string;
  decided?: string;
  decline_reason?: string;
  task_id?: string;
  note?: string;
  /** The person the vehicle is for, when it is not the asker (Phase 6). */
  on_behalf_of?: string;
  /** Bumped on every edit and decision; update_request and redecide_request send it back. */
  version?: number;
  fields?: RequestEditFields;
  /** An approved booking the requester edited: when, by whom, and what changed since it was approved. */
  changed?: { at: string; by?: string; note?: string };
  changes?: FieldChanges;
  events?: RequestEvent[];
  /** false = the vehicle's custodian drives (Part 6). */
  driver_required?: boolean;
  /** Booked directly by the office: request and task in one go. */
  one_step?: boolean;
  cancelled?: string;
  cancel_reason?: string;
  timeline?: RequestTimeline;
  /** Phase 7 (§35 18): waiting past its leave-by (it stays in the queue; never sent by itself). */
  late?: boolean;
  /** Phase 7 (§33): a proposed task's driver, vehicle, warnings and conflicts as proposed. */
  proposed?: RequestProposal;
  stops_count?: number;
  /** Phase 7 (§34): the trip, when the request was planned with its stops. */
  trip?: RequestTrip;
  /** Phase 7 (§4): the phone of a person who asked without an office account. */
  requester_phone?: string;
  /** Once approved (§4, §35 19): who drives, in what, with their photos. */
  assigned?: {
    driver: string;
    phone?: string;
    call?: string | null;
    whatsapp?: string | null;
    photo_url?: string;
    /** Hotfix 2 (J): "" when the vehicle is chosen on the day; vehicle_text says so ("Vehicle: on the day", "Any van"). */
    vehicle: string;
    vehicle_text?: string;
    make_model?: string;
    vehicle_photo_url?: string;
    vehicle_thumb_url?: string;
    task_status?: string;
  };
  /** For a person without an office account: the message for the trip's current moment and its WhatsApp link. */
  tell_requester?: { moment: "approved" | "driver_changed" | "on_the_way" | "arrived" | "cancelled"; message: string; whatsapp: string };
  /** Hotfix 2 (K): who decided it, with their number when they have one (else office_phone). */
  approved_by?: PersonAt;
  declined_by?: PersonAt & { reason?: string };
  cancelled_by?: PersonAt & { reason?: string };
  /** The approvers who have its decide page open right now ("Palitha is reviewing"). */
  reviewing?: { name: string; since: string }[];
  /** Hotfix 2 (A): the trip's live state, from its task (My trips). */
  live?: TripLive;
  /** Hotfix 2 (F): the office's own number (Call office), for the requester's pages. */
  office_phone?: PhoneLinks;
}

/** A person and when (Hotfix 2, K): "Approved by Palitha · 10:42". */
export interface PersonAt {
  name: string;
  /** "10:42" today, "Sat 17 Oct 10:42" another day. */
  at: string;
  photo_url?: string;
  /** Their number (E.164), "07X XXX XXXX", tel: and wa.me; absent when they have none (the page offers Call office). */
  phone?: string;
  phone_display?: string;
  call?: string;
  whatsapp?: string;
}

export interface PhoneLinks {
  phone: string;
  phone_display: string;
  call: string;
  whatsapp: string;
}

/** A trip's live state on My trips (Hotfix 2, A), from the request and its task. */
export interface TripLive {
  state: "waiting" | "approved" | "accepted" | "on_the_way" | "arrived" | "completed" | "declined" | "cancelled";
  /** "Waiting", "Approved", "Driver accepted · 09:12", "On the way · 09:30", "Arrived · 10:05", "Completed · 11:40",
   * "Declined · no vehicle that day", "Cancelled · not needed". */
  text: string;
  at?: string;
}

/** my_trips (Hotfix 2, A): the person's requests and proposed tasks over a range of days, newest first. */
export interface MyTrips extends Paged {
  from: string;
  to: string;
  /** Hotfix 3 (Hotfix 2's decision 2): all, the requests and proposals, or the tasks the person created directly. */
  include?: "all" | "requests" | "tasks";
  count: number;
  trips: (RequestCard | CreatedTaskCard)[];
}

/** A task the person created directly (no request), on My trips (Hotfix 3): it opens /tasks/:id. */
export interface CreatedTaskCard {
  source: "task";
  /** The task's id. */
  id: string;
  task_id: string;
  title: string;
  label?: string;
  kind?: TaskKind;
  when: string;
  back_by?: string;
  route?: string;
  stops_count?: number;
  /** The task's status (assigned, in_progress, completed, cancelled, declined, missed). */
  status: string;
  live: TripLive;
  assigned?: RequestCard["assigned"];
  approved_by?: PersonAt;
  /** "2026-10-18 10:42": when it was made. */
  created: string;
}

/** One item of the notification centre (Hotfix 2, A): my_inbox. */
export interface InboxItem {
  id: number;
  event: string;
  title: string;
  body?: string;
  url?: string;
  who?: string;
  /** "2026-10-18 10:42" (Colombo) and the same as words ("5 min ago"). */
  at: string;
  ago: string;
  read: boolean;
  /** The sound and the banner (B): urgent (a task to approve, needs a driver), alert (decided, declined), soft (on the
   * way, arrived), alarm (a critical issue), info (everything else: no sound). */
  kind: "urgent" | "alert" | "soft" | "alarm" | "info";
}

export interface Inbox extends Paged {
  unread: number;
  /** Hotfix 3 (L4): the last 30 days unless asked with archived (read items older than that are archived). */
  items: InboxItem[];
}

/** The office site's sound settings per person (Hotfix 2, B), in my_notification_settings. */
export interface SoundPrefs {
  on: boolean;
  /** 0 to 100 (default 70). */
  volume: number;
}

export interface RequestsList extends Paged {
  status: string;
  count: number;
  requests: RequestCard[];
}

export interface Driver {
  name: string;
  username: string;
  code?: string;
  phone?: string;
  active?: boolean;
  current_vehicle?: string;
  location?: string;
  has_login?: boolean;
  language?: string;
  licence?: { chip?: string; expiry?: string; days_left?: number };
  call?: string;
  whatsapp?: string;
  last_30_days?: { accepted: number; declined: number };
  /** Presence (Phase 6): sharing since HH:MM, or when the last sharing ended today. */
  on_duty_since?: string;
  off_duty_since?: string;
  /** Phase 7 (§5): the profile photo (a link that works for at least an hour). */
  photo_url?: string;
}

export interface Vehicle {
  reg_no: string;
  make_model?: string;
  type?: string;
  seats?: number;
  status?: string;
  km_this_month?: number;
  km_allowance?: number;
  odometer_km?: number;
  /** The custodian (Part 6) and the availability line: Free / On a task · back ~HH:MM / Booked later today · HH:MM / In garage. */
  assigned_to?: string;
  assigned_to_links?: Links;
  custodian_note?: string;
  availability?: string;
  back_at?: string;
  back_source?: "planned" | "live";
  /** Phase 7 (§6): the vehicle's photo and its thumbnail. */
  photo_url?: string;
  thumb_url?: string;
  /** Phase 7 (§28): the current document of each kind (no links: vehicle_documents has them) and what is missing. */
  document_files?: { kind: DocKind; name?: string; expiry?: string; has_file: boolean }[];
  documents_missing?: DocKind[];
  /** "3 documents missing: insurance, emission test, CR" */
  documents_missing_text?: string;
}

/** Phase 7 (§28): a vehicle's document kinds. */
export type DocKind = "revenue_licence" | "insurance" | "emission" | "registration" | "lease" | "other";

/** vehicle_documents: one document with its link (at least an hour). */
export interface VehicleDocument {
  id: string;
  kind: DocKind;
  /** "Insurance", or an Other's own name. */
  kind_name: string;
  name?: string;
  content_type: "image/jpeg" | "image/png" | "application/pdf";
  bytes?: number;
  expiry?: string;
  /** "17 Oct 2026 10:05 by Palitha" */
  uploaded: string;
  url?: string;
  removed?: string;
  removed_reason?: "removed" | "replaced";
}

export interface VehicleDocuments {
  vehicle: string;
  documents: VehicleDocument[];
  missing?: DocKind[];
  missing_text?: string;
  /** With removed: true, the removed and replaced ones. */
  removed?: VehicleDocument[];
}

/** photo_upload_url / vehicle_document_upload_url: a one-time signed upload (the browser sends the file itself). */
export interface UploadTicket {
  bucket: "driver-photos" | "vehicle-photos" | "vehicle-docs";
  path: string;
  token: string;
}

export interface Place {
  /** Since Part 4 (additive). */
  id?: string;
  name: string;
  /** Phase 7 (§15): removed by the office, "17 Oct 2026 10:05 by Sahan" (list_places removed, place_detail). */
  removed?: string;
  address?: string;
  kind?: string;
  operator?: "dialog" | "mobitel";
  site_id?: string;
  district?: string;
  pinned?: boolean;
  maps?: string;
}

/** search_places: one row of the location search box (Part 4). */
export interface SearchResult {
  /** google: Google's place search (the google package): a google_place_id, no pin until google_place. */
  layer: "place" | "recent" | "map" | "google";
  badge: string;
  name: string;
  detail?: string;
  id?: string;
  kind?: string;
  operator?: string;
  site_id?: string;
  pinned: boolean;
  lat?: number;
  lng?: number;
  last_used?: string;
  ref?: string;
  attribution?: string;
  google_place_id?: string;
}

/** google_place: a Google result's pin (kept 30 days on the server, never one of our places). */
export interface GooglePlaceAnswer {
  google_place_id: string;
  lat: number;
  lng: number;
  address?: string;
  short_address?: string;
  district?: string;
  fetched_at: string;
  kept_until: string;
  attribution: string;
}

export interface PastedPin {
  lat: number;
  lng: number;
  name?: string;
  from: "coordinates" | "link";
  maps?: string;
}

export interface SearchAnswer {
  text: string;
  results: SearchResult[];
  pin?: PastedPin;
  map_note?: string;
  map_cached?: boolean;
}

/** place_detail, update_place, save_place: everything about one place. */
export interface PlaceDetail extends Place {
  id: string;
  /** false = switched off (a removed place is off too). */
  active?: boolean;
  badge: string;
  other_ids?: string[];
  region?: string;
  depot?: string;
  lat?: number;
  lng?: number;
  source: string;
  pin_source?: string;
  attribution?: string;
  imported_at?: string;
  updated_at: string;
}

export interface ImportAnswer {
  import_id: string;
  preset: string;
  rows: number;
  added: number;
  updated: number;
  attached: number;
  unchanged: number;
  no_pin: number;
  skipped?: { row: number; reason: string }[];
}

export interface PlaceWithId extends Place {
  id?: string;
}

export interface SuggestedVehicle {
  reg_no: string;
  make_model?: string;
  type?: string;
  seats?: number;
  availability: string;
  pick: string;
  but?: string;
  regular_driver?: string;
  assigned_to?: string;
  custodian_note?: string;
  /** free_assigned: the custodian's links and "ask first"; busy: when it is back. */
  call?: string;
  whatsapp?: string;
  note?: string;
  back?: string;
}

export interface Suggestions {
  /** Absent when asked for a day and time rather than a request. */
  request?: RequestCard;
  window?: { when: string; back_by?: string; need?: string };
  vehicles: SuggestedVehicle[];
  drivers: { name: string; username: string; availability: string }[];
  groups?: { free_pool: SuggestedVehicle[]; free_assigned: SuggestedVehicle[]; busy: SuggestedVehicle[]; in_garage: SuggestedVehicle[] };
  drivers_free?: { name: string; username: string }[];
  /** The fleet setting: may a custodian drive with no driver assigned. */
  self_drive_allowed?: boolean;
  next?: string;
}

/** book_vehicle: the request, then the same fields as a created task. */
export interface BookResult {
  request: RequestCard;
  request_id?: string;
  task_id?: string;
  title?: string;
  when?: string;
  leave_by?: string;
  driver?: string;
  vehicle?: string;
  warnings?: string[];
  /** Phase 7 (§3). */
  vehicle_used?: VehicleUsed;
  vehicle_changed?: string;
}

export interface ProjectMatch {
  job_no?: string;
  short_name?: string;
  name?: string;
  customer_name?: string;
  status?: string;
}

export interface FindProject {
  count: number;
  matched_by?: string;
  projects: ProjectMatch[];
  note?: string;
}

export interface CreateTaskResult {
  /** Absent when the task was proposed instead (waiting_for_approval). */
  task_id?: string;
  title: string;
  /** Phase 7 (§33): no approve permission and tasks_need_approval on: it waits in the approval queue. */
  waiting_for_approval?: boolean;
  request_id?: string;
  /** "Waiting for the fleet admin's OK · you'll be notified." */
  next?: string;
  when?: string;
  leave_by?: string;
  leave_by_source?: string;
  driver?: string;
  vehicle?: string;
  plan?: PlanSummary;
  warnings?: string[];
  notes?: string[];
  /** Phase 7. */
  stops?: PlannedStop[];
  timeline?: PlanTimeline;
  conflicts?: Conflict[];
  vehicle_used?: VehicleUsed;
  vehicle_changed?: string;
}

export interface UpdateStopsResult {
  task_id: string;
  plan_version: number;
  leave_by?: string;
  plan?: PlanSummary;
  warnings?: string[];
  /** Phase 7 (§17): the stops in order with their labels, and the plan as a timeline. */
  stops?: PlannedStop[];
  timeline?: PlanTimeline;
}

export interface FleetSettings {
  /** Hotfix 2 (F): the office's own number, E.164 (+94…) (Call office). */
  office_phone?: string | null;
  /** Hotfix 2 (J): a task may be made with its vehicle chosen on the day or of a type (switched on after every phone has the update). */
  vehicle_on_the_day?: boolean;
  /** Phase 7 (§13): Start a trip in the app: allowed (Company preselected), default (Personal preselected), off; ask_first = allowed for now. */
  driver_personal_trips?: "allowed" | "default" | "off" | "ask_first";
  dwell_min: Record<string, number>;
  buffer_min: number;
  base_place_id: string | null;
  avg_speed_kmh: number;
  road_factor: number;
  accept_within_min: number;
  accept_before_leave_min: number;
  /** Phase 7 (§19): the driver's one reminder, minutes after the task was sent. */
  accept_reminder_min?: number;
  rush_hour: { factor: number; centre: { lat: number; lng: number }; radius_km: number; bands: { days: number[]; from: string; to: string }[] };
  /** Off = every booking needs a driver (Part 7). */
  self_drive_allowed?: boolean;
  /** Phase 7 (§33): a task made by someone without approve waits for an approver (default on). */
  tasks_need_approval?: boolean;
  /** The driver app's shift nudge: HH:MM on these days (0 = Sunday … 6 = Saturday). */
  shift_start?: string;
  shift_days?: number[];
  /** Phase 7: drivers still on duty after this time are clocked out (not while a task runs); "" = off. */
  duty_cutoff?: string;
  /** What the driver shows while recording a fuel video (Phase 6, Part 3). */
  fuel_video_checklist?: ChecklistItem[];
  /** The recording quality on the phone and how long the files are kept (Part 3b). */
  fuel_video_quality?: "480p" | "720p";
  fuel_video_keep_months?: 6 | 12;
  /** The location search's map calls a day and a minute (openrouteservice autocomplete; Part 4, 4b). */
  ors_autocomplete_daily_cap?: number;
  ors_autocomplete_per_minute?: number;
  /** Part 5b: the route views' estimated lines over GPS gaps, new ones a day. */
  ors_gap_daily_cap?: number;
  /** Part 5: google (Google's map, places, traffic times, snap where keys exist) or open. */
  map_package?: "google" | "open";
  /** Google calls a day and a month per feature; the month at most 95 % of the free usage. */
  google_caps?: Record<GoogleFeature, { day: number; month: number }>;
}

export type GoogleFeature = "map_loads" | "places_autocomplete" | "places_details" | "routes" | "roads";

export interface GoogleFeatureUsage {
  feature: GoogleFeature;
  label: string;
  today: number;
  day_cap: number;
  month: number;
  month_cap: number;
  refused_today: number;
  on: boolean;
  note?: string;
}

export interface ChecklistItem {
  key: string;
  en: string;
  si: string;
  /** The word on the office's timeline ("Plate 0:04"); the English text when missing. */
  short?: string;
}

export interface SettingsResult {
  settings: FleetSettings;
  defaults: FleetSettings;
  about: Record<string, string>;
  base_place: { id: string; name: string; address?: string | null; has_pin: boolean } | null;
  routing_provider: string;
  /** Part 5: the package in use, the keys set (never the keys), each feature's calls against its caps. */
  google?: {
    package: "google" | "open";
    chosen: "google" | "open";
    configured: { js: boolean; server: boolean };
    in_use: { map: boolean; places: boolean; routes: boolean; roads: boolean };
    usage: GoogleFeatureUsage[];
  };
  note?: string;
}

export interface RoutingUsage {
  provider: string;
  daily_budget: { ors: number };
  days: { day: string; provider: string; calls: number; errors: number }[];
}

export interface DecideResult {
  request: "approved" | RequestCard;
  requested_by?: string;
  task_id?: string;
  warnings?: string[];
  /** Phase 7 (§3): the vehicle the task took, why, and a choice against the driver's default. */
  vehicle?: string;
  vehicle_used?: VehicleUsed;
  vehicle_changed?: string;
  leave_by?: string;
  /** Phase 7 (§33): a proposed task sent with nothing changed. */
  as_proposed?: boolean;
  conflicts?: Conflict[];
}

export type ShareState = "sharing" | "stale" | "not_sharing";

export interface LiveDriver extends StatusFields {
  driver: string;
  username: string;
  employee_id?: string;
  /** Phase 7 (§5, §6). */
  photo_url?: string;
  vehicle_thumb_url?: string;
  state: ShareState;
  location?: string;
  updated?: string;
  near?: string | null;
  speed_kmh?: number;
  battery_pct?: number | null;
  source?: string;
  vehicle?: string;
  task?: string;
  going_to?: string;
  lat?: number;
  lng?: number;
  links?: Links;
  next_stop?: string;
  eta_next?: string;
  eta_final?: string;
  late_min?: number;
  /** Set by a Realtime row: the ISO time of the last position. */
  recorded_at?: string | null;
  /** Heading of the last position in degrees, when the phone gave one (the marker turns with it). */
  heading?: number | null;
  /** Sharing since HH:MM (Phase 6). */
  on_duty_since?: string;
  /** Fuel videos still on the phone, and their bytes (Phase 6, Part 3). */
  video_uploads_waiting?: number;
  video_bytes_waiting?: number;
  /** Phase 7: every active driver is listed with a duty: on a task, on duty (clocked in), off duty; since HH:MM. */
  duty?: DutyState;
  duty_text?: string;
  duty_since?: string;
  /** Off duty: "auto at the cut-off", "by the office", "by the driver". */
  off_duty_how?: string;
  /** The vehicle held since HH:MM (not shown for a task's vehicle). */
  vehicle_since?: string;
  /** Today's hand-over: "WP CAB-4521 taken over from Nuwan 08:40" or "WP CAB-4521 now with Kamal 08:40". */
  vehicle_note?: string;
  /** "App stopped by phone 3× today" (heartbeat gaps over 3 minutes on duty). */
  app_stops_today?: number;
  app_stops_text?: string;
  /** The phone's brand and model ("OPPO CPH2119"). */
  phone?: string;
  task_id?: string;
  /** Phase 7 (§19): "declined the 09:00 task" or "hasn't accepted the 09:00 task". */
  task_note?: string;
}

export type DutyState = "on_task" | "on_duty" | "off_duty";

export interface LiveDrivers {
  as_of: string;
  counts: { all: number; sharing: number; stale: number; not_sharing: number };
  status_counts?: { live: number; no_signal: number; location_off: number; not_sharing: number };
  /** Phase 7. */
  duty_counts?: { on_task: number; on_duty: number; off_duty: number };
  drivers: LiveDriver[];
}

/** duty_log (Phase 7): one row per duty period, newest first. */
export interface DutyPeriod {
  driver?: string;
  username?: string;
  day: string;
  clock_in: string;
  /** "17:40", "Fri 16 Oct 08:02" (a later day), or "on duty". */
  clock_out: string;
  /** "driver", "auto at the cut-off", "office". */
  out_how?: string;
  opened_by_server?: boolean;
  hours: number;
  vehicles: { vehicle: string; from: string; to?: string; how: string; ended?: string; by: string; ended_by?: string }[];
  tasks: { task_id: string; title: string; started: string; completed?: string; status: string; km?: number }[];
  task_km: number;
  gps_km?: number;
  phone?: string;
}

export interface DutyLog extends Paged {
  from: string;
  to: string;
  driver?: string;
  periods: DutyPeriod[];
  totals: { periods: number; hours: number; task_km: number; gps_km?: number };
  gps_note?: string;
}

export interface RouteStop {
  from: string;
  to: string;
  minutes: number;
  near?: string | null;
  maps?: string;
  lat?: number;
  lng?: number;
}

export type SegmentKind = "driving" | "stopped" | "no_gps" | "no_data";
export type GapKind = "no_gps" | "no_data";

/**
 * A row of the timeline: a driving leg, a stop of 10 minutes or more, over 10 minutes with no GPS fix while the
 * phone kept sending heartbeats (no_gps), or with nothing at all (no_data: the app was not running).
 */
export interface RouteSegment {
  kind: SegmentKind;
  from: string;
  to: string;
  from_at: string;
  to_at: string;
  minutes: number;
  km?: number;
  near?: string | null;
  lat?: number;
  lng?: number;
  /** The leg's points reached the server over 5 minutes late (the phone was offline): when they landed, "HH:MM" and ISO. */
  uploaded?: string;
  uploaded_at?: string;
  text: string;
}

/** Over 2 minutes between two line points at different places: drawn dashed, labelled by its kind. */
export interface RouteHole {
  from_at: string;
  to_at: string;
  minutes: number;
  kind: GapKind;
  text: string;
}

export interface DriverRoute {
  driver: string;
  date: string;
  window?: { from: string; to: string };
  task?: { id: string; title: string; started?: string; completed?: string | null };
  recorded_points: number;
  usable_points?: number;
  repeated_points?: number;
  first_point?: string;
  last_point?: string;
  last_position?: string;
  km?: number;
  km_note?: string;
  driving_minutes?: number;
  stopped_minutes?: number;
  stops_count?: number;
  stops_over_10_min?: RouteStop[];
  gaps?: { from: string; to: string; minutes: number; kind?: GapKind; text?: string }[];
  holes?: RouteHole[];
  uploaded_later?: { from: string; to: string; uploaded: string; from_at: string; to_at: string }[];
  timeline?: RouteSegment[];
  /** columns: time, lat, lng, km/h, the ISO time and (new) the accuracy; older answers have four or five columns. */
  route?: { columns: string[]; points: (string | number | null)[][] };
  /** The same line with the driving legs snapped to roads (snap: true and a provider set); a "snapped" column flags its points. */
  route_snapped?: { columns: string[]; points: (string | number | null)[][] };
  /** Part 5b (estimate_gaps): each gap of over 300 m and 60 s as the likely road, [lat, lng]; for the map, never km. */
  estimated?: { from_at: string; to_at: string; from: string; to: string; km_road?: number; points: [number, number][] }[];
  estimated_note?: string;
  snapped?: { provider: string; status: "off" | "ok" | "partial" | "failed"; legs?: number; matched?: number };
  points_stored?: number;
  points_shown?: number;
  outlier_points?: number;
  heartbeats?: number;
  note?: string;
}

// ---- Phase 4: vehicles, drivers, mileage, maintenance, accounts ----

export interface DocChip {
  chip?: string;
  expiry?: string;
  days_left?: number;
}

export interface VehicleCard extends Vehicle {
  /** Phase 7: the driver who holds it now (vehicle_assignments), since HH:MM. */
  held_by?: string;
  held_since?: string;
  rented_from?: string;
  rent_until?: string;
  monthly_rent_lkr?: number;
  regular_driver?: string;
  next_service?: string;
  service_state?: string;
  garage_booked?: string;
  documents?: { lic?: DocChip; ins?: DocChip; emi?: DocChip };
  in_garage?: boolean;
  active?: boolean;
}

export interface VehiclesList extends Paged {
  filter: string;
  month?: string;
  counts: { all: number; on_task: number; available: number; in_garage: number; documents_expiring: number; inactive?: number };
  vehicles: VehicleCard[];
}

export interface DriversList extends Paged {
  count: number;
  drivers: Driver[];
}

/** Rows the generic table shows: flat objects, numbers right-aligned. */
export type Row = Record<string, string | number | boolean | null | undefined>;

export interface MileageTotals {
  tasks: number;
  task_km: number;
  /** Phase 7 (§13): personal trips' km, apart from the task km charged to jobs. */
  personal_km?: number;
  fuel_litres: number;
  fuel_lkr: number;
  unlogged_km_flags: number;
  check_odometer: number;
  between_tasks_km: number;
  overnight_km: number;
}

export interface MileageSummary {
  month: string;
  vehicle?: string;
  driver?: string;
  /** Phase 7 (§8): with from/to, the range's own rows and totals (the top level stays the month that contains to). */
  range?: { from: string; to: string; totals: MileageTotals; vehicles: Row[]; biggest_gaps: Row[]; unlogged_km: Row[]; check_odometer: Row[] };
  totals: {
    tasks: number;
    task_km: number;
    personal_km?: number;
    fuel_litres: number;
    fuel_lkr: number;
    unlogged_km_flags: number;
    check_odometer: number;
    between_tasks_km: number;
    overnight_km: number;
  };
  vehicles: Row[];
  biggest_gaps: Row[];
  unlogged_km: Row[];
  check_odometer: Row[];
  photo_links?: string;
}

export interface VehicleReport {
  id: string;
  reported: string;
  vehicle?: string;
  vehicle_in_garage?: boolean;
  driver?: string;
  category: string;
  note?: string | null;
  status: "open" | "in_garage" | "closed";
  office_note?: string | null;
  closed?: string;
  task_id?: string | null;
  photos: string[];
  driver_links?: Links;
}

export interface VehicleReports extends Paged {
  status: string;
  count: number;
  reports: VehicleReport[];
  photo_links?: string;
}

export interface OfficeKey {
  id: string;
  label?: string | null;
  created: string;
  last_used: string;
}

export interface OfficeUser {
  name: string;
  email?: string | null;
  /** Hotfix 2 (F): E.164 (+94…); phone_display "07X XXX XXXX". */
  phone?: string | null;
  phone_display?: string;
  role: string;
  permissions?: string[];
  active: boolean;
  since?: string;
  connector_keys: OfficeKey[];
}

export interface OfficeUsers extends Paged {
  count: number;
  users: OfficeUser[];
}

export interface CreateOfficeUserResult {
  created: { name: string; email: string; role: string; permissions?: string[]; code: string; id: string };
  set_password_link: string;
  link_valid_for?: string;
  next?: string;
}

export interface UpdateOfficeUserResult {
  updated: { name: string; email?: string | null; phone?: string | null; role: string; permissions: string[] };
}

export interface SetPasswordLinkResult {
  name: string;
  email: string;
  set_password_link: string;
  link_valid_for?: string;
}

export interface CreateKeyResult {
  name: string;
  key_id: string;
  connector_url: string;
  note?: string;
}

// ---- Phase 5, Part 3a: issues ----
export type IssueSeverity = "info" | "warning" | "critical";
export type IssueStatus = "open" | "in_progress" | "resolved" | "dismissed";
export interface Issue {
  id: string;
  /** Hotfix 3 (L2): snoozed until then ("2026-10-19 07:00"); by whom. */
  snoozed_until?: string;
  snoozed_by?: string;
  kind: string;
  kind_text?: string;
  scope?: "task" | "fleet";
  severity: IssueSeverity | string;
  title: string;
  detail?: string;
  due?: string;
  status: IssueStatus | string;
  opened: string;
  updated: string;
  resolved?: string;
  resolved_by?: string;
  resolution_note?: string;
  assigned_to?: { name: string; email?: string };
  /** Phase 7 (§9): "System · Vehicle problem" or the person; who took it and when; when it was resolved or dismissed. */
  opened_by?: string;
  taken_by?: { name: string; at?: string };
  resolved_at?: string;
  vehicle?: string;
  driver?: string;
  driver_username?: string;
  task_id?: string;
  request_id?: string;
  vehicle_report_id?: string;
  driver_links?: Links;
}
export interface IssuesList {
  status: string;
  from?: string;
  to?: string;
  sort?: "urgent" | "newest";
  count: number;
  open: number;
  in_progress: number;
  /** Hotfix 3 (L2): how many active ones are snoozed (left out of the Overview and the counts). */
  snoozed?: number;
  issues: Issue[];
  total?: number;
  next?: string;
}
export interface IssueEvent {
  at: string;
  actor?: string;
  action: string;
  note?: string;
  from?: string;
  to?: string;
}
export interface IssueHistory {
  issue: Issue;
  events: IssueEvent[];
  task?: { id: string; title: string; status: string; driver?: string; vehicle?: string; leave_by?: string };
  report?: { id: string; category: string; note?: string | null; status: string; office_note?: string | null; reported: string; driver?: string; vehicle?: string; task_id?: string; photos: string[] };
  request?: { id: string; requested_by: string; route?: string; when: string; status: string; task_id?: string };
}

// Settings → Notifications (my_notification_settings and the three tools that answer the same).
export interface NotificationEvent {
  event: string;
  label: string;
  text: string;
  enabled: boolean;
}
export interface NotificationDevice {
  id: string;
  device: string;
  since: string;
  last_ok?: string;
  endpoint_hash: string;
}
export interface NotificationSettings {
  events: NotificationEvent[];
  devices: NotificationDevice[];
  push: { configured: boolean; public_key?: string };
  /** Hotfix 2 (B): the office site's sounds (set_my_notification_settings({ sound })). */
  sound?: SoundPrefs;
  registered?: { id: string; device: string; endpoint_hash: string };
  removed?: number;
}

/** The task change tools' answers (Phase 6). */
export interface UpdateTaskResult {
  task_id: string;
  title?: string;
  when?: string;
  leave_by?: string;
  until?: string;
  driver?: string;
  plan_version: number;
  changes: FieldChanges;
  warnings?: string[];
  sent?: string;
}

export interface UpdateRequestResult {
  request: RequestCard;
  needs_reapproval: boolean;
  changes: FieldChanges;
  next?: string;
}

export interface RedecideResult {
  request: RequestCard;
  decision: "kept" | "changed" | "postponed" | "declined";
  task?: { task_id: string; when?: string; until?: string; driver?: string; vehicle?: string; plan_version?: number; changes?: FieldChanges };
  task_cancelled?: string;
  warnings?: string[];
  sent?: string;
}

/** availability(at, until): who is on duty, off duty or on a task, and whether they are free then. */
export interface AvailableDriver {
  name: string;
  username?: string | null;
  /** Hotfix 2 (F): Call and WhatsApp for people who may see drivers' numbers (approve, assign_tasks, vehicles, issues). */
  phone?: PhoneLinks;
  /** Hotfix 2 (J): information only, never a block: "no vehicle yet · regular: WP CAB-4521". */
  vehicle_note?: string;
  state: "on_task" | "on_duty" | "off_duty";
  status_text: string;
  on_duty_since?: string;
  off_duty_since?: string;
  current_task?: { title: string; ends_planned?: string; ends_live?: string };
  next_task_start?: string;
  accepted_today: number;
  declined_today: number;
  licence: { chip: "ok" | "orange" | "red" | "not set"; expiry?: string };
  free: boolean;
  busy_with?: string;
  /** Phase 7: the vehicle the driver holds today (on duty), else their regular one. */
  vehicle?: { reg_no: string; source: "on_duty" | "regular" };
  /** Phase 7 (§3): the place in the best-match ranking (1 = best). */
  rank?: number;
  /** A ranked row: straight-line km from the last position to the first stop (0.1 km), when both are known. */
  km_to_first?: number;
  /** A ranked row: its best-match reasons ("On duty · free 09:00–end of day · 0.4 km from the pickup · 1 task today"). */
  match_why?: string;
  /** Phase 7 (§5). */
  photo_url?: string;
}

export interface Availability {
  as_of: string;
  window: { from: string; until: string; day: string };
  drivers: AvailableDriver[];
  /** Phase 7 (§3): the best match for the window (and the first stop, when given). */
  best?: BestMatch;
  counts: { free: number; on_duty: number; all: number };
  vehicles: { groups: NonNullable<Suggestions["groups"]>; drivers_free: { name: string; username: string }[]; self_drive_allowed?: boolean };
}

/** list_import_presets: the built-in presets and the mappings saved by name (Part 4b). */
export interface ImportPreset {
  key: string;
  id?: string;
  name: string;
  built_in: boolean;
  mapping: import("@fleet/sites").Mapping;
  saved_by?: string;
  saved_at?: string;
}

/** list_place_imports: one import with its counts and its undo. */
export interface PlaceImport {
  id: string;
  at: string;
  by: string;
  file?: string;
  preset: string;
  rows: number;
  added: number;
  updated: number;
  attached?: number;
  unchanged?: number;
  no_pin?: number;
  skipped?: number;
  undone?: { at: string; by?: string; switched_off?: number; restored?: number; left_as_is?: number; left_names?: string[] };
}

export interface UndoAnswer {
  import_id: string;
  switched_off: number;
  restored: number;
  left_as_is: number;
  left_names?: string[];
}

/** Phase 7 (§8): one row of the task history (list_tasks). */
export interface HistoryTask {
  id: string;
  date: string;
  time: string;
  title: string;
  label?: string;
  kind: TaskKind;
  purpose: TripPurpose;
  status: string;
  driver?: string;
  driver_username?: string;
  vehicle?: string;
  from?: string;
  to?: string;
  stops_count: number;
  started?: string;
  completed?: string;
  km?: number;
  cancelled_reason?: string;
  created_by?: string;
}

export interface TaskHistory extends Paged {
  from: string;
  to: string;
  count: number;
  /** Over 500: the sentence that says so. */
  more?: string;
  totals: { completed: number; cancelled: number; km: number; driver_started: number; personal: number };
  tasks: HistoryTask[];
}

/** set_trip_purpose's answer. */
export interface TripPurposeResult {
  task_id: string;
  purpose: TripPurpose;
  project?: string;
  was?: TripPurpose;
  note?: string;
}

/** Hotfix 3 (L1, L5): a person's page preferences, kept on the server (my_prefs, set_my_prefs merges what it is given). */
export interface OfficePrefs {
  /** The Overview's collapsed sections: "requests", "needs_driver", "critical", "tiles", "road", "attention", "my_trips". */
  overview_collapsed?: string[];
  /** The side menu's collapsed sections: "today", "fleet", "reports", "admin". */
  menu_collapsed?: string[];
}
