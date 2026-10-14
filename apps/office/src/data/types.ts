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
}

/** The status fields every driver card carries (live_drivers, fleet_overview). */
export interface StatusFields {
  status?: DriverStatus;
  status_text?: string;
  status_since?: string;
  last_position_at?: string;
  heartbeat_at?: string;
  location_on?: boolean;
  permission?: string;
  app_version?: string;
  queued_points?: number;
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
  due?: string;
  level?: string;
  /** Phase 5: the issue behind the item (opens /issues/:id). */
  issue_id?: string;
  kind?: string;
  severity?: string;
}

export interface Overview {
  date: string;
  as_of?: string;
  vehicles: { on_the_road: number; total: number; parked: number; in_garage?: number };
  tasks: { total: number; in_progress: number; done: number; assigned?: number; cancelled?: number };
  requests: { waiting: number; oldest?: string };
  reminders: { count: number; red?: number; window_days?: number };
  on_the_road: RoadDriver[];
  needs_attention: Attention[];
}

export interface BoardCard {
  id: string;
  time: string;
  started_on?: string;
  label?: string;
  title: string;
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
}

export interface Board {
  date: string;
  counts: { assigned: number; in_progress: number; completed: number; cancelled: number; declined?: number };
  assigned: BoardCard[];
  in_progress: BoardCard[];
  completed: BoardCard[];
  /** Needs a driver (Phase 5): declined by the driver, not yet reassigned. */
  declined?: BoardCard[];
}

export interface AssignmentEvent {
  at: string;
  action: string;
  driver?: string;
  vehicle?: string;
  actor?: string;
  note?: string;
}
/** Who is free at a task's time (task_detail.suggestions for a declined task). */
export interface FreeAt {
  drivers: { name: string; username?: string | null; availability: string }[];
  vehicles: { reg_no: string; make_model?: string | null; type: string; seats?: number | null; availability: string }[];
}

export interface Stop {
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
  done?: string;
  skip_reason?: string;
  skip_note?: string;
  navigate?: string;
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
  type: string;
  what?: string;
  place?: string;
  arrive_by?: string;
  planned_arrive?: string;
  planned_depart?: string;
  dwell_min?: number;
  pin?: string;
}

export interface PlanPreview {
  date: string;
  leave_by: string;
  leave_by_at?: string;
  leave_by_source: string;
  start?: { name: string; has_pin: boolean };
  stops: PlannedStop[];
  plan?: PlanSummary;
  warnings: string[];
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
  litres: number | null;
  amount_lkr: number;
  odometer_km?: number | null;
  at: string;
  receipt_photo?: string;
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
    label?: string;
    status: "assigned" | "in_progress" | "completed" | "cancelled" | "declined" | string;
    status_line?: string;
    start: string;
    end_by?: string;
    driver?: string;
    vehicle?: string;
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
    return_to_base?: boolean;
    avoid_expressway?: boolean;
    plan_version?: number;
    eta?: TaskEta;
  };
  plan?: PlanSummary;
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
  cancelled?: string;
}

export interface RequestCard {
  id: string;
  requested_by: string;
  project?: string;
  when: string;
  back_by?: string;
  route?: string;
  need?: string;
  status: "waiting" | "approved" | "declined" | "cancelled";
  asked?: string;
  decided?: string;
  decline_reason?: string;
  task_id?: string;
  note?: string;
  /** false = the vehicle's custodian drives (Part 6). */
  driver_required?: boolean;
  /** Booked directly by the office: request and task in one go. */
  one_step?: boolean;
  cancelled?: string;
  cancel_reason?: string;
  timeline?: RequestTimeline;
}

export interface RequestsList {
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
}

export interface Place {
  name: string;
  address?: string;
  kind?: string;
  maps?: string;
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
  task_id: string;
  title: string;
  when?: string;
  leave_by?: string;
  leave_by_source?: string;
  driver?: string;
  vehicle?: string;
  plan?: PlanSummary;
  warnings?: string[];
  notes?: string[];
}

export interface UpdateStopsResult {
  task_id: string;
  plan_version: number;
  leave_by?: string;
  plan?: PlanSummary;
  warnings?: string[];
}

export interface FleetSettings {
  dwell_min: Record<string, number>;
  buffer_min: number;
  base_place_id: string | null;
  avg_speed_kmh: number;
  road_factor: number;
  accept_within_min: number;
  accept_before_leave_min: number;
  rush_hour: { factor: number; centre: { lat: number; lng: number }; radius_km: number; bands: { days: number[]; from: string; to: string }[] };
  /** Off = every booking needs a driver (Part 7). */
  self_drive_allowed?: boolean;
}

export interface SettingsResult {
  settings: FleetSettings;
  defaults: FleetSettings;
  about: Record<string, string>;
  base_place: { id: string; name: string; address?: string | null; has_pin: boolean } | null;
  routing_provider: string;
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
}

export type ShareState = "sharing" | "stale" | "not_sharing";

export interface LiveDriver extends StatusFields {
  driver: string;
  username: string;
  employee_id?: string;
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
}

export interface LiveDrivers {
  as_of: string;
  counts: { all: number; sharing: number; stale: number; not_sharing: number };
  status_counts?: { live: number; no_signal: number; location_off: number; not_sharing: number };
  drivers: LiveDriver[];
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

export type SegmentKind = "driving" | "stopped" | "no_data";

/** A row of the timeline: a driving leg, a stop of 10 minutes or more, or over 10 minutes with no data. */
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
  gaps?: { from: string; to: string; minutes: number }[];
  timeline?: RouteSegment[];
  /** columns: time, lat, lng, km/h and (new) the ISO time; older answers have four columns. */
  route?: { columns: string[]; points: (string | number)[][] };
  note?: string;
}

// ---- Phase 4: vehicles, drivers, mileage, maintenance, accounts ----

export interface DocChip {
  chip?: string;
  expiry?: string;
  days_left?: number;
}

export interface VehicleCard extends Vehicle {
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

export interface VehiclesList {
  filter: string;
  month?: string;
  counts: { all: number; on_task: number; available: number; in_garage: number; documents_expiring: number; inactive?: number };
  vehicles: VehicleCard[];
}

export interface DriversList {
  count: number;
  drivers: Driver[];
}

/** Rows the generic table shows: flat objects, numbers right-aligned. */
export type Row = Record<string, string | number | boolean | null | undefined>;

export interface MileageSummary {
  month: string;
  vehicle?: string;
  driver?: string;
  totals: {
    tasks: number;
    task_km: number;
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

export interface VehicleReports {
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
  phone?: string | null;
  role: string;
  permissions?: string[];
  active: boolean;
  since?: string;
  connector_keys: OfficeKey[];
}

export interface OfficeUsers {
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
  count: number;
  open: number;
  in_progress: number;
  issues: Issue[];
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
  registered?: { id: string; device: string; endpoint_hash: string };
  removed?: number;
}
