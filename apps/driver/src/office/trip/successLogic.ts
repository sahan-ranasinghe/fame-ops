// Hotfix O2-H2, Part 1b: where the trip editor goes after a save, the rules only (pure, tested by scripts/test-success.ts).
// Gmail's "Sent", Google Calendar's "Event saved": the form closes, the new or changed item opens (its detail screen when
// this person may open it, else the list it belongs to), a snackbar says what happened (with an action where one helps:
// WhatsApp the driver when asked for), and the save's warnings and conflicts wait on the screen landed on
// (office/savedNotice.ts).

import type { Outcome } from './formsLogic';

export type SuccessTarget =
  | { kind: 'task'; id: string }
  | { kind: 'request'; id: string }
  | { kind: 'list'; path: '/office/(tabs)/tasks' | '/office/(tabs)/trips' | '/office' };

export interface Success {
  target: SuccessTarget;
  /** The snackbar's i18n key (office.saved.*). */
  snack: 'taskAssigned' | 'taskWaiting' | 'requestSent' | 'booked' | 'changesSaved' | 'stopsSaved';
  /** The key the warnings wait under (the landed screen's SavedNotice). */
  noticeKey: string;
  /** The lines for SavedNotice: the warnings, then the conflicts' sentences. */
  notice: string[];
}

export function successOf(
  o: Pick<Outcome, 'kind' | 'mode' | 'taskId' | 'requestId' | 'warnings' | 'conflicts'>,
  may: { openTasks: boolean; openRequests: boolean; request: boolean },
): Success {
  const notice = [...o.warnings, ...o.conflicts.map((c) => c.text)];
  const list: SuccessTarget = { kind: 'list', path: o.mode === 'task' && may.openTasks ? '/office/(tabs)/tasks' : may.request ? '/office/(tabs)/trips' : '/office' };
  const task = (id?: string): SuccessTarget | null => (id && may.openTasks ? { kind: 'task', id } : null);
  const request = (id?: string): SuccessTarget | null => (id && may.openRequests ? { kind: 'request', id } : null);
  let target: SuccessTarget;
  let snack: Success['snack'];
  switch (o.kind) {
    case 'sent':
      target = task(o.taskId) ?? list;
      snack = o.mode === 'stops' ? 'stopsSaved' : 'taskAssigned';
      break;
    case 'waiting':
      target = request(o.requestId) ?? list;
      snack = 'taskWaiting';
      break;
    case 'booked':
      target = task(o.taskId) ?? request(o.requestId) ?? list;
      snack = 'booked';
      break;
    case 'request_sent':
      target = request(o.requestId) ?? list;
      snack = 'requestSent';
      break;
    default:
      target = o.mode === 'stops' ? task(o.taskId) ?? list : request(o.requestId) ?? list;
      snack = o.mode === 'stops' ? 'stopsSaved' : 'changesSaved';
  }
  const noticeKey = target.kind === 'list' ? target.path : `${target.kind}:${target.id}`;
  return { target, snack, noticeKey, notice };
}

/** The request id an answer carries: at the top (book_vehicle) or inside `request` (create_request, update_request). */
export function requestIdOf(out: { request_id?: string; request?: { id?: string } } | null | undefined): string | undefined {
  return out?.request_id ?? out?.request?.id ?? undefined;
}
