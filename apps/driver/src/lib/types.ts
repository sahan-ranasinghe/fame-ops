import type { Database } from './database.types';

type Tables = Database['public']['Tables'];

export type Employee = Tables['employees']['Row'];
export type Task = Tables['tasks']['Row'];
export type TaskStop = Tables['task_stops']['Row'];
/** One vehicle's stretch of a task when the office swapped the vehicle during it (Phase 7; none without a swap). */
export type TaskSegment = Tables['task_vehicle_segments']['Row'];
/** task_vehicle_segments is absent on a task cached by an older version of the app. */
export type TaskWithStops = Task & { task_stops: TaskStop[]; task_vehicle_segments?: TaskSegment[] };
export type VehicleReport = Tables['vehicle_reports']['Row'];
export type OdometerLog = Tables['odometer_logs']['Row'];
export type FuelLog = Tables['fuel_logs']['Row'];

/** The only vehicle columns a driver may read (see VEHICLE_COLUMNS in api.ts). */
export type Vehicle = Pick<
  Tables['vehicles']['Row'],
  | 'id'
  | 'reg_no'
  | 'make_model'
  | 'vehicle_type'
  | 'seats'
  | 'current_odometer_km'
  | 'monthly_km_allowance'
  | 'in_garage'
  | 'active'
  | 'photo_path'
  | 'photo_thumb_path'
>;

export type Language = 'en' | 'si';
export type ReportCategory = 'breakdown' | 'accident' | 'tyre' | 'warning_light' | 'other';
export type PhotoKind = 'odometer' | 'fuel_receipt' | 'vehicle_report' | 'profile';
