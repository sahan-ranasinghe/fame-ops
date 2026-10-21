// A task made with no vehicle (Hotfix 2, J): the driver confirms one at Start task, before the odometer. Pure: no
// React, so scripts/test-preview.ts runs it.
//
//   - Which tasks: every task still to start whose vehicle is chosen on the day (vehicle_mode driver_day = the vehicle the
//     driver holds on the day, any_type = any vehicle of vehicle_type_wanted), every time Start task is pressed, also when
//     a vehicle was confirmed before (the driver backed out, or the task came from another driver): the vehicle in hand
//     today is the one that counts.
//   - Use the vehicle the driver holds when it fits (the right type for any_type, not in the garage), else pick one of
//     the list (my_vehicle_choices; any_type: that type only).
//   - The server decides (confirm_task_vehicle): 'ok', or a refusal said in words. It refuses a task going in progress
//     with no vehicle, so the confirm goes first: online it is called at once (a refusal is said on the screen, nothing
//     else is sent); offline it is a queue op (task_vehicle) put in the queue before the start's ops and sent as queued:
//     the server then takes the vehicle the driver really drove and notes what it would have refused (in the garage, the
//     wrong type, the office's vehicle set meanwhile) for the office, so the start and the readings behind it are kept.
//     Only a task no longer theirs is refused (not_yours).

import { keyExists } from '../i18n/keys';
import type { Op } from '../sync/engine';
import { typeWord, vehicleMode, type Translate } from './taskPreview';
import type { TaskWithStops } from './types';

export type ConfirmAnswer = 'ok' | 'not_yours' | 'started' | 'has_vehicle' | 'inactive' | 'in_garage' | 'wrong_type';

const ANSWERS: ConfirmAnswer[] = ['ok', 'not_yours', 'started', 'has_vehicle', 'inactive', 'in_garage', 'wrong_type'];

/** The RPC's word, or null for anything else (an unknown word is treated as a refusal by the caller). */
export function confirmAnswer(value: unknown): ConfirmAnswer | null {
  return ANSWERS.find((a) => a === value) ?? null;
}

type TaskOf = Pick<TaskWithStops, 'status' | 'vehicle_id' | 'vehicle_mode' | 'vehicle_type_wanted'>;

/** The task's vehicle is confirmed at Start task (chosen on the day), or set by the office (specific). */
export function needsVehicle(task: TaskOf): boolean {
  return (vehicleMode(task) !== 'specific' || !task.vehicle_id) && (task.status === 'assigned' || task.status === 'declined');
}

/** The type the task wants (any_type), else null (any vehicle will do). */
export function wantedType(task: TaskOf): string | null {
  return vehicleMode(task) === 'any_type' ? task.vehicle_type_wanted ?? null : null;
}

/** What the rules read of a vehicle (a saved vehicle, or a row of my_vehicle_choices). */
type VehicleOf = { vehicle_type: string | null; in_garage: boolean };

/** Whether this vehicle can be confirmed for the task: 'ok', or the refusal the server would give. */
export function vehicleFits(task: TaskOf, vehicle: VehicleOf): 'ok' | 'wrong_type' | 'in_garage' {
  if (vehicle.in_garage) return 'in_garage';
  const type = wantedType(task);
  if (type && vehicle.vehicle_type !== type) return 'wrong_type';
  return 'ok';
}

/** The vehicle the driver holds, offered first ("Use WP CAB-4521") when it fits; else null (the list). */
export function heldFits<V extends VehicleOf>(task: TaskOf, held: V | null): V | null {
  return held && vehicleFits(task, held) === 'ok' ? held : null;
}

/** The vehicles to pick from: for any_type only that type; the ones that fit first, the garage ones last (marked). */
export function candidates<V extends VehicleOf>(task: TaskOf, list: readonly V[]): V[] {
  const type = wantedType(task);
  const rank = (v: V) => (vehicleFits(task, v) === 'ok' ? 0 : 1);
  return list.filter((v) => !type || v.vehicle_type === type).sort((a, b) => rank(a) - rank(b));
}

/**
 * Why the vehicle was refused, in words ("WP CAB-4521 is in the garage."): the screens put it in vehicleConfirm.failed
 * ("Couldn't set the vehicle: …"). A word the strings do not have yet (vehicleConfirm.hasVehicle, vehicleConfirm.inactive)
 * is the server's word.
 */
export function refusalWords(t: Translate, answer: string, plate: string, type: string | null): string {
  const has = (key: string) => keyExists(key);
  switch (answer) {
    case 'wrong_type':
      return t('vehicleConfirm.wrongType', { plate, type: typeWord(t, type ?? 'other') });
    case 'in_garage':
      return t('vehicleConfirm.inGarage', { plate });
    case 'not_yours':
      return t('task.alreadyReassigned');
    case 'started':
      return t('task.alreadyStarted');
    case 'has_vehicle':
      return has('vehicleConfirm.hasVehicle') ? t('vehicleConfirm.hasVehicle') : answer;
    case 'inactive':
      return has('vehicleConfirm.inactive') ? t('vehicleConfirm.inactive', { plate }) : answer;
    default:
      return answer;
  }
}

/** The queue op of an offline confirm: the task's id, the vehicle, and when the driver confirmed it. */
export function taskVehicleOp(taskId: string, vehicleId: string, at: string): Extract<Op, { kind: 'task_vehicle' }> {
  return { kind: 'task_vehicle', id: taskId, vehicle_id: vehicleId, at };
}

/** The server's word in a refused task_vehicle op's message ("task vehicle: in_garage" → in_garage). */
export function refusedAnswer(message: string): string {
  const m = /task vehicle: (\w+)\s*$/.exec(message);
  return m ? m[1] : message;
}
