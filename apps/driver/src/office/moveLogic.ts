// Office mode (Stage 1, O3 item 4c): Move to vehicle from Live's card, the site's MoveVehicle in its "move" mode (a driver
// on duty without a task; on a task it is Task detail's Swap vehicle). The rules only (pure): the rows are the swap's
// (office/taskExtrasLogic.ts swapRows: the driver's vehicle first, the free ones, the held ones, the garage, those on
// another running task last and not selectable) with No vehicle on top, the search over them, whether Move is offered,
// the line under the list, move_driver_vehicle's input and the sentence after it. Keys for the words.

import type { SwapRow } from './taskExtrasLogic';

/** '' in the choice = No vehicle. */
export const NO_VEHICLE = '';

/** The driver's vehicle now, or No vehicle. */
export const currentChoice = (rows: readonly SwapRow[]): string => rows.find((r) => r.state === 'current')?.reg_no ?? NO_VEHICLE;

/** A move to another vehicle (or to none): never the current one again, never one on someone's running task. */
export function canMove(rows: readonly SwapRow[], choice: string | null): boolean {
  if (choice === null || choice === currentChoice(rows)) return false;
  if (choice === NO_VEHICLE) return true;
  const r = rows.find((x) => x.reg_no === choice);
  return !!r && r.state !== 'on_task';
}

/** The rows the search keeps: the plate (spaces and dashes do not matter) or the make and model; all when empty. */
export function searchRows(rows: readonly SwapRow[], text: string): SwapRow[] {
  const q = text.trim().toLowerCase();
  if (!q) return [...rows];
  const key = q.replace(/[\s-]/g, '');
  return rows.filter((r) => r.reg_no.toLowerCase().replace(/[\s-]/g, '').includes(key) || r.what.toLowerCase().includes(q));
}

/** The line under the list: what Move will do, or why it is not offered (a key and its words). */
export function moveHint(rows: readonly SwapRow[], choice: string | null, first: string): { key: string; vars: Record<string, string> } {
  const current = currentChoice(rows);
  if (choice === null || choice === current) {
    return current ? { key: 'office.live.movePickOther', vars: { name: first, plate: current } } : { key: 'office.live.moveNoneNow', vars: { name: first } };
  }
  if (choice === NO_VEHICLE) return { key: 'office.live.moveStays', vars: { name: first } };
  const r = rows.find((x) => x.reg_no === choice);
  if (!r) return { key: 'office.live.moveNoneNow', vars: { name: first } };
  if (r.state === 'on_task') return { key: 'office.live.moveOnTask', vars: { plate: r.reg_no } };
  return r.held_by ? { key: 'office.live.moveTakesFrom', vars: { holder: r.held_by, plate: r.reg_no } } : { key: 'office.live.moveTakes', vars: { name: first, plate: r.reg_no } };
}

/** move_driver_vehicle's input: the driver's username and the plate, or null for no vehicle. */
export const moveInput = (username: string, choice: string): { driver: string; vehicle: string | null } => ({ driver: username, vehicle: choice === NO_VEHICLE ? null : choice });

/** move_driver_vehicle's answer: vehicle is the label ("WP CAB-4521 · Toyota HiAce") or "none". */
export interface MoveResult {
  driver: string;
  vehicle: string;
  taken_from?: string;
  note?: string;
}

/** "Kamal Perera is now on WP CAB-4521." + "Nuwan Perera was told." (keys and their words, in order). */
export function moveSentences(r: MoveResult): { key: string; vars: Record<string, string> }[] {
  const plate = (r.vehicle ?? '').split(' · ')[0];
  const out: { key: string; vars: Record<string, string> }[] = [r.vehicle && r.vehicle !== 'none' ? { key: 'office.live.movedTo', vars: { name: r.driver, plate } } : { key: 'office.live.movedNone', vars: { name: r.driver } }];
  if (r.taken_from) out.push({ key: 'office.live.movedTold', vars: { name: r.taken_from } });
  return out;
}

