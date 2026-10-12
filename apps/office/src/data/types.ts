// The JSON the tools answer (the contract in scripts/tool-shapes.json). Only
// the fields the screens read are typed; everything is optional where the
// tool leaves it out.

export interface Links {
  maps?: string;
  whatsapp?: string;
  call?: string;
}

export interface RoadDriver {
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
  driver?: string;
  vehicle?: string;
  status?: string;
}

export interface Board {
  date: string;
  counts: { assigned: number; in_progress: number; completed: number; cancelled: number };
  assigned: BoardCard[];
  in_progress: BoardCard[];
  completed: BoardCard[];
}

export interface Stop {
  seq: number;
  type: string;
  place?: string;
  address?: string;
  status: string;
  arrived?: string;
  done?: string;
  navigate?: string;
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
    status: "assigned" | "in_progress" | "completed" | "cancelled";
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
    started?: string;
    completed?: string;
    cancelled_reason?: string | null;
    start_odometer_km?: number | null;
    end_odometer_km?: number | null;
    km?: number | null;
    gps_km?: number;
    gps_km_note?: string;
  };
  stops: Stop[];
  projects: string | ProjectShare[];
  odometer: OdometerRead[];
  unlogged_km?: { km: number; last_logged_km: number; last_logged_at: string; start_km: number };
  fuel: FuelRead[];
  vehicle_reports: ReportRead[];
  from_request?: { id: string; requested_by: string; project?: string; asked: string };
  driver_links?: Links;
  photo_links?: string;
}

export interface RequestCard {
  id: string;
  requested_by: string;
  project?: string;
  when: string;
  back_by?: string;
  route?: string;
  need?: string;
  status: "waiting" | "approved" | "declined";
  asked?: string;
  decided?: string;
  decline_reason?: string;
  task_id?: string;
  note?: string;
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
}

export interface Place {
  name: string;
  address?: string;
  kind?: string;
  maps?: string;
}

export interface Suggestions {
  request: RequestCard;
  vehicles: { reg_no: string; make_model?: string; type?: string; seats?: number; availability: string; pick: string; but?: string; regular_driver?: string }[];
  drivers: { name: string; username: string; availability: string }[];
  next?: string;
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
  driver?: string;
  vehicle?: string;
  warnings?: string[];
  notes?: string[];
}

export interface DecideResult {
  request: "approved" | RequestCard;
  requested_by?: string;
  task_id?: string;
  warnings?: string[];
}
