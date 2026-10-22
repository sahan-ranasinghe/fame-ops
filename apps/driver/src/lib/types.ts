import type { Database } from './database.types';

type Tables = Database['public']['Tables'];

export type Employee = Tables['employees']['Row'];
export type Task = Tables['tasks']['Row'];
export type TaskStop = Tables['task_stops']['Row'];
/** One vehicle's stretch of a task when the office swapped the vehicle during it (Phase 7; none without a swap). */
export type TaskSegment = Tables['task_vehicle_segments']['Row'];
/** Round 4–7 (§33.3): who rides on the task, as a driver may read them (removed_at null = riding). */
export type TaskPassenger = Pick<Tables['task_passengers']['Row'], 'id' | 'name' | 'phone' | 'removed_at'>;
/**
 * task_vehicle_segments is absent on a task cached by an older version of the app; task_passengers too (and on a trip
 * the phone made itself).
 */
export type TaskWithStops = Task & { task_stops: TaskStop[]; task_vehicle_segments?: TaskSegment[]; task_passengers?: TaskPassenger[] };
export type VehicleReport = Tables['vehicle_reports']['Row'];
export type OdometerLog = Tables['odometer_logs']['Row'];
export type FuelLog = Tables['fuel_logs']['Row'];

/**
 * The only vehicle columns a driver may read (see VEHICLE_COLUMNS in api.ts). Round 4–7 (§33.2): the fuel type and grade,
 * absent on a copy the phone kept from an older version of the app.
 */
export type Vehicle = Partial<Pick<Tables['vehicles']['Row'], 'fuel_type' | 'fuel_grade'>> & Pick<
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
/** Round 4–7 (§33.1): Damage (dents, scratches, glass) is the sixth category, what a check before work finds most. */
export type ReportCategory = 'breakdown' | 'accident' | 'tyre' | 'warning_light' | 'damage' | 'other';
export type PhotoKind = 'odometer' | 'fuel_receipt' | 'vehicle_report' | 'profile' | 'licence' | 'vehicle_check';
/** Round 4–7 (§33.1): the side of one of an all-good vehicle check's optional four photos. */
export type CheckSide = 'front' | 'back' | 'left' | 'right';
